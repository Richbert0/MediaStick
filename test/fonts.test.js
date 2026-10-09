'use strict';
/**
 * Symbole & Emojis müssen auf jedem System erscheinen – auch ohne installierte Emoji-Schrift
 * (z. B. Raspberry Pi OS). Dafür liefert die App eigene Schriften aus (tools/build-fonts.py).
 * Dieser Test stellt sicher, dass
 *  - jedes Sonderzeichen der Oberfläche von den mitgelieferten Schriften abgedeckt ist und
 *  - jede Schriftliste die mitgelieferten Symbol-/Emoji-Schriften enthält.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', 'app');
const FONTS = path.join(APP, 'fonts');
const IGNORE = new Set([0xFE0E, 0xFE0F, 0xFEFF, 0x200D]);

function files(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (p !== FONTS) files(p, out); } else if (/\.(html|js|css|json)$/.test(e.name)) out.push(p);
  }
  return out;
}

function parseRanges(str) {
  return str.split(',').map(s => s.trim()).filter(Boolean).map(r => {
    const [a, b] = r.replace(/^U\+/i, '').split('-');
    return [parseInt(a, 16), parseInt(b || a, 16)];
  });
}

test('Schriftdateien und symbols.css sind vorhanden und eingebunden', () => {
  const css = fs.readFileSync(path.join(FONTS, 'symbols.css'), 'utf8');
  for (const m of css.matchAll(/url\(\/fonts\/([^)]+)\)/g)) {
    assert.ok(fs.statSync(path.join(FONTS, m[1])).size > 1000, 'Schrift fehlt oder leer: ' + m[1]);
  }
  assert.match(css, /font-family:'MC Emoji'/);
  assert.match(css, /font-family:'MC Symbols'/);
  assert.match(fs.readFileSync(path.join(FONTS, 'fonts.css'), 'utf8'), /@import url\('\/fonts\/symbols\.css'\)/);
});

test('jedes Sonderzeichen der Oberfläche wird von den mitgelieferten Schriften abgedeckt', () => {
  const covered = parseRanges(JSON.parse(fs.readFileSync(path.join(FONTS, 'symbols.json'), 'utf8')).ranges);
  const ok = cp => covered.some(([a, b]) => cp >= a && cp <= b);
  const missing = new Map();
  for (const f of files(APP)) {
    const s = fs.readFileSync(f, 'utf8');
    for (const ch of s) {
      const cp = ch.codePointAt(0);
      if (cp < 0x80 || IGNORE.has(cp) || ok(cp)) continue;
      missing.set(cp, path.relative(APP, f));
    }
  }
  const list = [...missing].map(([cp, f]) => `U+${cp.toString(16).toUpperCase()} ${String.fromCodePoint(cp)} (${f})`);
  assert.deepStrictEqual(list, [], 'Nicht abgedeckt – bitte `python3 tools/build-fonts.py <quellen>` ausführen oder das Zeichen ersetzen');
});

test('jede Schriftliste enthält die mitgelieferten Symbol- und Emoji-Schriften', () => {
  const bad = [];
  for (const f of files(APP)) {
    const s = fs.readFileSync(f, 'utf8');
    const re = /(?:font-family|--[\w-]*font[\w-]*|--gk-(?:mono|display))\s*:\s*([^;}\n]+)|ctx\.font\s*=\s*'([^']+)'/g;
    for (const m of s.matchAll(re)) {
      const v = m[1] || m[2];
      if (!/(sans-serif|serif|monospace)/.test(v)) continue; // var(), inherit, @font-face-Namen
      if (!/MC Emoji/.test(v) || !/MC Symbols/.test(v)) bad.push(path.relative(APP, f) + ': ' + v.trim().slice(0, 80));
    }
  }
  assert.deepStrictEqual(bad, []);
});
