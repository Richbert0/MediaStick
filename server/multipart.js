'use strict';
/**
 * Streamender multipart/form-data-Parser ohne externe Abhängigkeiten.
 * Dateien werden direkt auf die Platte geschrieben (kein Puffern ganzer Uploads im RAM).
 */

const fs = require('fs');
const path = require('path');

const MAX_FIELD = 256 * 1024;
const MAX_HEADER = 16 * 1024;

function getBoundary(contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType || '');
  return m ? (m[1] || m[2]) : null;
}

function parseHeaders(raw) {
  const headers = {};
  for (const line of raw.split('\r\n')) {
    const i = line.indexOf(':');
    if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  const disp = headers['content-disposition'] || '';
  const name = (/\bname="([^"]*)"/i.exec(disp) || [])[1] || '';
  let filename = null;
  const fnStar = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(disp);
  if (fnStar) {
    try { filename = decodeURIComponent(fnStar[1].replace(/"/g, '')); } catch { filename = fnStar[1]; }
  } else {
    const fn = /\bfilename="([^"]*)"/i.exec(disp);
    if (fn) filename = Buffer.from(fn[1], 'latin1').toString('utf8');
  }
  // Browser senden UTF-8 als Bytes; latin1→utf8 nur übernehmen, wenn gültig
  if (filename && filename.includes('�')) {
    const fn = /\bfilename="([^"]*)"/i.exec(disp);
    filename = fn ? fn[1] : filename;
  }
  return { name, filename, contentType: headers['content-type'] || 'application/octet-stream' };
}

/**
 * @param {http.IncomingMessage} req
 * @param {object} opts
 * @param {(part:{name,filename,contentType}, fields:object) => Promise<string|null>} opts.fileTarget
 *        liefert den Zielpfad für eine Datei (oder null zum Verwerfen)
 * @param {number} [opts.maxFileSize]
 * @returns {Promise<{fields:Object<string,string>, files:Array<{field,filename,path,size,contentType}>}>}
 */
function parseMultipart(req, opts) {
  return new Promise((resolve, reject) => {
    const boundary = getBoundary(req.headers['content-type']);
    if (!boundary) { reject(httpError(400, 'Kein multipart-Boundary')); return; }

    const dashBoundary = Buffer.from('--' + boundary);
    const delimiter = Buffer.from('\r\n--' + boundary);
    const maxFileSize = opts.maxFileSize || Infinity;

    const fields = {};
    const files = [];
    let buf = Buffer.alloc(0);
    let state = 'preamble';
    let part = null;          // aktueller Teil
    let out = null;           // WriteStream für Dateien
    let fieldChunks = null;
    let fieldSize = 0;
    let fileSize = 0;
    let finished = false;
    let failed = false;
    let processing = Promise.resolve();
    const tempFiles = [];

    function fail(err) {
      if (failed) return;
      failed = true;
      req.unpipe?.();
      req.resume();
      if (out) out.destroy();
      for (const t of tempFiles) fs.unlink(t, () => {});
      reject(err);
    }

    function write(data) {
      if (!data.length) return;
      if (out) {
        fileSize += data.length;
        if (fileSize > maxFileSize) { fail(httpError(413, 'Datei zu groß')); return; }
        if (!out.write(data)) {
          req.pause();
          out.once('drain', () => req.resume());
        }
      } else if (fieldChunks) {
        fieldSize += data.length;
        if (fieldSize > MAX_FIELD) { fail(httpError(413, 'Feld zu groß')); return; }
        fieldChunks.push(data);
      }
    }

    function endPart() {
      if (!part) return Promise.resolve();
      const p = part;
      part = null;
      if (fieldChunks) {
        fields[p.name] = Buffer.concat(fieldChunks).toString('utf8');
        fieldChunks = null;
        return Promise.resolve();
      }
      if (out) {
        const stream = out;
        out = null;
        const size = fileSize;
        return new Promise((res, rej) => {
          stream.end(() => {
            files.push({ field: p.name, filename: p.filename, path: p.tmp, target: p.target, size, contentType: p.contentType });
            res();
          });
          stream.on('error', rej);
        });
      }
      return Promise.resolve();
    }

    async function startPart(info) {
      part = info;
      fileSize = 0;
      fieldSize = 0;
      if (info.filename != null && info.filename !== '') {
        const target = await opts.fileTarget(info, fields);
        if (!target) { part.discard = true; return; }
        await fs.promises.mkdir(path.dirname(target), { recursive: true });
        const tmp = path.join(path.dirname(target), '.upload-' + process.pid + '-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.part');
        tempFiles.push(tmp);
        part.tmp = tmp;
        part.target = target;
        out = fs.createWriteStream(tmp);
        out.on('error', fail);
      } else {
        fieldChunks = [];
      }
    }

    function processBuffer() {
      // läuft synchron, bis mehr Daten oder ein asynchroner Schritt nötig sind
      while (!failed) {
        if (state === 'preamble') {
          const i = buf.indexOf(dashBoundary);
          if (i < 0) { buf = buf.slice(Math.max(0, buf.length - dashBoundary.length)); return null; }
          buf = buf.slice(i + dashBoundary.length);
          state = 'after-boundary';
        } else if (state === 'after-boundary') {
          if (buf.length < 2) return null;
          if (buf[0] === 0x2d && buf[1] === 0x2d) { state = 'done'; return null; }
          if (buf[0] === 0x0d && buf[1] === 0x0a) { buf = buf.slice(2); state = 'headers'; continue; }
          fail(httpError(400, 'Ungültiges multipart-Format'));
          return null;
        } else if (state === 'headers') {
          const i = buf.indexOf('\r\n\r\n');
          if (i < 0) {
            if (buf.length > MAX_HEADER) fail(httpError(400, 'Header zu groß'));
            return null;
          }
          const info = parseHeaders(buf.slice(0, i).toString('latin1'));
          buf = buf.slice(i + 4);
          state = 'body';
          return startPart(info); // asynchron
        } else if (state === 'body') {
          const i = buf.indexOf(delimiter);
          if (i >= 0) {
            if (!part || !part.discard) write(buf.slice(0, i));
            buf = buf.slice(i + delimiter.length);
            state = 'after-boundary';
            return endPart();
          }
          // alles bis auf den möglichen Anfang eines Delimiters schreiben
          const keep = delimiter.length - 1;
          if (buf.length > keep) {
            if (!part || !part.discard) write(buf.slice(0, buf.length - keep));
            buf = buf.slice(buf.length - keep);
          }
          return null;
        } else {
          buf = Buffer.alloc(0);
          return null;
        }
      }
      return null;
    }

    function pump() {
      processing = processing.then(async () => {
        for (;;) {
          if (failed) return;
          const step = processBuffer();
          if (!step) break;
          req.pause();
          await step;
          req.resume();
        }
        if (finished && !failed) {
          if (state !== 'done') { fail(httpError(400, 'Upload unvollständig')); return; }
          resolve({ fields, files });
        }
      }).catch(fail);
    }

    req.on('data', chunk => {
      if (failed) return;
      buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
      pump();
    });
    req.on('end', () => { finished = true; pump(); });
    req.on('aborted', () => fail(httpError(400, 'Upload abgebrochen')));
    req.on('error', fail);
  });
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

/** Kleine Bodies (JSON) einlesen. */
function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(httpError(413, 'Anfrage zu groß')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJsonBody(req, limit) {
  const body = await readBody(req, limit);
  if (!body.length) return {};
  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    throw httpError(400, 'Ungültiges JSON');
  }
}

module.exports = { parseMultipart, readBody, readJsonBody, httpError, getBoundary };
