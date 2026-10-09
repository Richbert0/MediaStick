'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { analyse, isPrivateIp, checkFrame } = require('../server/framecheck');

const H = obj => new Headers(obj);

test('Einbettung: X-Frame-Options und frame-ancestors werden erkannt', () => {
  assert.strictEqual(analyse(H({})).embeddable, true);
  assert.strictEqual(analyse(H({ 'x-frame-options': 'SAMEORIGIN' })).embeddable, false);
  assert.strictEqual(analyse(H({ 'x-frame-options': 'deny' })).embeddable, false);
  assert.strictEqual(analyse(H({ 'content-security-policy': "default-src 'self'; frame-ancestors 'self' https://a.example" })).embeddable, false);
  assert.strictEqual(analyse(H({ 'content-security-policy': "frame-ancestors 'none'" })).embeddable, false);
  assert.strictEqual(analyse(H({ 'content-security-policy': 'frame-ancestors *' })).embeddable, true);
  assert.strictEqual(analyse(H({ 'content-security-policy': "script-src 'self'" })).embeddable, true);
});

test('Einbettung: Adressen im eigenen Netz werden nicht abgefragt', async () => {
  for (const ip of ['127.0.0.1', '10.0.0.5', '192.168.1.20', '172.16.3.4', '169.254.1.1', '::1', 'fd00::1', '100.64.0.1']) {
    assert.ok(isPrivateIp(ip), ip);
  }
  for (const ip of ['8.8.8.8', '1.1.1.1', '2a00:1450:4001::200e']) assert.ok(!isPrivateIp(ip), ip);
  const r = await checkFrame('http://127.0.0.1:1/');
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /eigenen Netz/);
  assert.strictEqual((await checkFrame('file:///etc/passwd')).ok, false);
  assert.strictEqual((await checkFrame('kein url')).ok, false);
});
