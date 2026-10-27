import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const viewerPath = new URL('../public/showcase/willowmere/releases/art-direction-20261027-v1/viewer/viewer.js', import.meta.url);

function harness({ reduced = false, rejectAt = -1 } = {}) {
  const ids = [
    'viewport', 'overworld', 'sideFull', 'sideNear', 'sideSky', 'sideMiddle', 'panorama',
    'waterDetail', 'courier', 'courierDetail', 'reedling', 'reedlingDetail',
    'playOverworld', 'playSide', 'tour', 'reset', 'reduced', 'loadStatus', 'retryLoad', 'artwork',
    'overworldStatus', 'sideStatus',
  ];
  class Element {
    constructor(id) {
      this.id = id; this.tagName = id === 'reset' || id === 'tour' || id.startsWith('play') ? 'BUTTON' : id === 'reduced' ? 'INPUT' : 'DIV';
      this.attributes = new Map(); this.dataset = {}; this.style = {}; this.hidden = false;
      this.disabled = false; this.checked = false; this.textContent = ''; this.onclick = null; this.onchange = null;
      this.decode = async () => {};
    }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    querySelectorAll(selector) { return selector === 'img' ? domImages : []; }
  }
  const elements = new Map(ids.map(id => [id, new Element(id)]));
  elements.get('artwork').hidden = true;
  elements.get('retryLoad').hidden = true;
  const domImages = ids.filter(id => ['overworld', 'sideFull', 'sideNear', 'sideSky', 'sideMiddle', 'panorama', 'waterDetail', 'courier', 'courierDetail', 'reedling', 'reedlingDetail'].includes(id)).map(id => elements.get(id));
  const decodeResolvers = [];
  let imageCount = 0;
  class MockImage {
    constructor() { this.src = ''; this.index = imageCount++; this.decode = () => new Promise((resolve, reject) => { decodeResolvers.push({ resolve, reject, index: this.index }); }); }
  }
  const rafs = [];
  const listeners = new Map();
  const document = { querySelector: selector => elements.get(selector.slice(1)), querySelectorAll: () => [] };
  const context = {
    document, Image: MockImage, HTMLElement: Element,
    matchMedia: () => ({ matches: reduced }),
    requestAnimationFrame: callback => { rafs.push(callback); return rafs.length; },
    addEventListener: (name, callback) => listeners.set(name, callback),
    location: { reload: () => { context.reloaded = true; } },
    console, setTimeout, clearTimeout,
  };
  context.window = context;
  const resolveNext = () => {
    const pending = decodeResolvers.shift();
    assert.ok(pending, 'expected another image decode');
    if (pending.index === rejectAt) pending.reject(new Error('image unavailable'));
    else pending.resolve();
  };
  return { context, elements, decodeResolvers, rafs, listeners, resolveNext, imageCount: () => imageCount };
}

async function start(options) {
  const source = await readFile(viewerPath, 'utf8');
  const h = harness(options);
  vm.runInNewContext(source, h.context, { filename: viewerPath.pathname });
  return h;
}

const flush = () => new Promise(resolve => setImmediate(resolve));

test('holds all viewer playback until all 73 release images decode', async () => {
  const h = await start();
  assert.equal(h.imageCount(), 73);
  assert.equal(h.elements.get('artwork').hidden, true);
  assert.equal(h.context.showcaseState.ready, false);
  assert.equal(h.rafs.length, 0);

  for (let i = 0; i < 71; i++) {
    h.resolveNext();
    await flush();
    assert.equal(h.context.showcaseState.ready, false);
    assert.equal(h.rafs.length, 0);
  }
  // The final parallax layer must decode before the viewer can become playable.
  h.resolveNext();
  await flush();
  assert.equal(h.context.showcaseState.ready, false);
  assert.equal(h.rafs.length, 0);
  h.resolveNext();
  await flush();
  assert.equal(h.context.showcaseState.loadState, 'ready');
  assert.equal(h.context.showcaseState.ready, true);
  assert.equal(h.elements.get('artwork').hidden, false);
  assert.equal(h.elements.get('playOverworld').disabled, false);
  assert.equal(h.rafs.length, 1);
});

test('keeps artwork hidden and exposes retry without starting RAF after a decode failure', async () => {
  const h = await start({ rejectAt: 72 });
  for (let i = 0; i < 73; i++) {
    h.resolveNext();
    await flush();
  }
  await flush();
  assert.equal(h.context.showcaseState.loadState, 'error');
  assert.equal(h.context.showcaseState.ready, false);
  assert.equal(h.elements.get('artwork').hidden, true);
  assert.equal(h.elements.get('retryLoad').hidden, false);
  assert.equal(h.elements.get('playOverworld').disabled, true);
  assert.equal(h.elements.get('playSide').disabled, true);
  assert.equal(h.elements.get('tour').disabled, true);
  assert.equal(h.rafs.length, 0);
});

test('reduced motion disables playback and focused controls do not consume movement keys', async () => {
  const h = await start({ reduced: true });
  for (let i = 0; i < 73; i++) { h.resolveNext(); await flush(); }
  await flush();
  assert.equal(h.context.showcaseState.ready, true);
  assert.equal(h.context.showcaseState.reducedMotion, true);
  assert.equal(h.elements.get('playOverworld').disabled, true);
  assert.equal(h.elements.get('playSide').disabled, true);
  assert.equal(h.elements.get('tour').disabled, true);
  const before = h.context.showcaseState.courierX;
  let prevented = false;
  h.listeners.get('keydown')({ key: 'ArrowRight', repeat: false, target: h.elements.get('tour'), preventDefault: () => { prevented = true; } });
  assert.equal(prevented, false);
  assert.equal(h.context.showcaseState.courierX, before);
});
