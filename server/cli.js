#!/usr/bin/env node
'use strict';
/**
 * MediaCenter-Server ohne Desktop-Fenster starten (Browser-/Server-Modus).
 *
 *   node server/cli.js [--port 8080] [--data <ordner>] [--host 0.0.0.0] [--app <app-ordner>]
 *
 * Umgebungsvariablen: MEDIACENTER_PORT, MEDIACENTER_DATA_DIR
 */

const path = require('path');
const { createMediaServer, VERSION } = require('./index');
const { lanAddresses } = require('./util');

function arg(name) {
  const i = process.argv.indexOf('--' + name);
  if (i > 0 && process.argv[i + 1]) return process.argv[i + 1];
  const pref = process.argv.find(a => a.startsWith('--' + name + '='));
  return pref ? pref.split('=').slice(1).join('=') : undefined;
}

async function main() {
  const appDir = path.resolve(arg('app') || path.join(__dirname, '..', 'app'));
  const dataDir = path.resolve(arg('data') || process.env.MEDIACENTER_DATA_DIR || appDir);
  const portArg = arg('port') || process.env.MEDIACENTER_PORT;
  const srv = createMediaServer({
    appDir, dataDir,
    port: portArg ? Number(portArg) : 8080,
    strictPort: !!portArg,
    host: arg('host') || '0.0.0.0',
    log: m => console.log(m),
  });
  const port = await srv.start();
  const line = '='.repeat(56);
  console.log('\n' + line);
  console.log(`   MediaCenter Server v${VERSION}`);
  console.log(line);
  console.log(`   Lokal:  http://localhost:${port}/`);
  for (const a of lanAddresses()) console.log(`   LAN:    http://${a.address}:${port}/${a.virtual ? '  (virtuell)' : ''}`);
  console.log(`   Daten:  ${dataDir}`);
  console.log('   Stop:   STRG+C');
  console.log(line + '\n');

  const stop = () => { console.log('\n  Server wird beendet…'); srv.close().then(() => process.exit(0)); setTimeout(() => process.exit(0), 2000).unref(); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch(e => {
  console.error('Start fehlgeschlagen:', e.message);
  process.exit(1);
});
