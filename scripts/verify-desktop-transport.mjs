// Run with the real Electron executable, not ELECTRON_RUN_AS_NODE.
// No BrowserWindow is created; every network request stays on loopback.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { once } from 'node:events';
import { app, BrowserWindow, net } from 'electron';
const root = resolve(process.argv.find(value => value.startsWith('--root='))?.slice(7) || process.cwd());
assert.ok(process.versions.electron, 'Use the real Electron runtime.');
assert.equal(process.type, 'browser', 'Run as Electron main, not ELECTRON_RUN_AS_NODE.');
app.setPath('userData', mkdtempSync(join(tmpdir(), 'pixelwall-transport-regression-')));
app.disableHardwareAcceleration();

// Extract the production transport expression without executing main.mjs,
// which would open the editor. This makes reverting the wiring to net.fetch
// fail this regression on its actual response URL behavior.
function configuredTransport() {
  const repoRequire = createRequire(join(root, 'package.json'));
  const ts = repoRequire('typescript');
  const file = ts.createSourceFile('main.mjs', readFileSync(join(root, 'desktop/main.mjs'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const matches = [];
  function walk(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'createUpdateController') matches.push(node);
    ts.forEachChild(node, walk);
  }
  walk(file);
  assert.equal(matches.length, 1, 'Expected one production update controller.');
  const options = matches[0].arguments[0];
  assert.ok(ts.isObjectLiteralExpression(options), 'Expected explicit updater options.');
  const transport = options.properties.find(p => ts.isPropertyAssignment(p) && p.name.getText(file) === 'fetch');
  assert.ok(transport, 'Production updater must provide a fetch transport.');
  const actual = runInNewContext(`(${transport.initializer.getText(file)})`, { globalThis: { fetch: globalThis.fetch }, net });
  assert.equal(typeof actual, 'function');
  return actual;
}

let server;
const watchdog = setTimeout(() => { console.error('Native transport regression exceeded 20 seconds.'); app.exit(1); }, 20000);
void app.whenReady().then(async () => {
  const fetch = configuredTransport();
  const requests = [];
  const payload = JSON.stringify({ schemaVersion: 1, version: '0.2.1', message: 'PixelWall local fixture' });
  let fixtureOrigin;
  server = createServer((request, response) => {
    requests.push({ url: request.url, accept: request.headers.accept, cookie: request.headers.cookie, authorization: request.headers.authorization });
    if (request.url === '/relative-redirect') { response.writeHead(302, { location: '/must-not-follow' }); response.end(); return; }
    if (request.url === '/absolute-redirect') { response.writeHead(307, { location: `${fixtureOrigin}/must-not-follow` }); response.end(); return; }
    if (request.url === '/waiting') return;
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(payload) });
    response.end(payload);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  fixtureOrigin = `http://127.0.0.1:${server.address().port}`;
  const options = () => ({ redirect: 'error', credentials: 'omit', cache: 'no-store', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(3000) });

  const url = `${fixtureOrigin}/manifest`;
  const response = await fetch(url, options());
  assert.equal(response.status, 200);
  assert.equal(response.url, url, 'Transport must retain the real response URL for strict feed validation.');
  assert.equal(response.redirected, false);
  assert.equal(response.headers.get('content-type').split(';')[0], 'application/json');
  assert.equal(response.headers.get('content-length'), String(Buffer.byteLength(payload)));
  assert.equal(typeof response.body.getReader, 'function');
  const reader = response.body.getReader();
  const pieces = [];
  try {
    while (true) { const chunk = await reader.read(); if (chunk.done) break; pieces.push(Buffer.from(chunk.value)); }
  } finally { reader.releaseLock(); }
  assert.equal(Buffer.concat(pieces).toString('utf8'), payload);
  assert.equal(requests[0].accept, 'application/json');
  assert.equal(requests[0].cookie, undefined);
  assert.equal(requests[0].authorization, undefined);

  for (const path of ['/relative-redirect', '/absolute-redirect']) {
    const before = requests.length;
    await assert.rejects(fetch(fixtureOrigin + path, options()), 'Redirect must reject rather than follow.');
    assert.deepEqual(requests.slice(before).map(request => request.url), [path], 'Redirect destination must receive zero requests.');
  }
  const abort = new AbortController();
  const waiting = fetch(`${fixtureOrigin}/waiting`, { ...options(), signal: abort.signal });
  const cancel = setTimeout(() => abort.abort(), 30);
  try { await assert.rejects(waiting, error => error.name === 'AbortError'); }
  finally { clearTimeout(cancel); }

  assert.equal(BrowserWindow.getAllWindows().length, 0, 'Regression must remain headless.');
  console.log(JSON.stringify({ status: 'passed', electron: process.versions.electron, node: process.versions.node, undici: process.versions.undici, checks: ['production-transport-wiring', 'native-response-url-and-stream', 'json-request-without-credentials', 'relative-redirect-rejected-before-follow', 'absolute-redirect-rejected-before-follow', 'in-flight-request-aborted', 'no-browser-windows'], network: 'loopback-only' }));
}).then(() => { clearTimeout(watchdog); server?.closeAllConnections(); server?.close(); app.exit(0); }).catch(error => { clearTimeout(watchdog); console.error(error.stack || String(error)); server?.closeAllConnections(); server?.close(); app.exit(1); });
