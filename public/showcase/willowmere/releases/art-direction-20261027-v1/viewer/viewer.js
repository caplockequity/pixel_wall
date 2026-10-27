(() => {
  const q = selector => document.querySelector(selector);
  const prefersReduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const state = window.showcaseState = {
    ready: false, loadState: 'loading', release: 'art-direction-20261027-v1',
    overworldFrame: 0, sideFrame: 0, courierFrame: 0,
    courierX: 116, courierY: 138, camera: 0, facing: 1, vy: 0,
    playing: !prefersReduced, sidePlaying: !prefersReduced,
    reducedMotion: prefersReduced, tour: false, keys: {},
  };
  // This viewer and every URL it uses belong to the same immutable release.
  const assetRoot = '../exports';
  const framePath = (name, frame) => `${assetRoot}/${name}/frame-${String(frame).padStart(2, '0')}.png`;
  const nearPath = frame => `${assetRoot}/sideview/near-${String(frame).padStart(2, '0')}.png`;
  const skyPath = `${assetRoot}/sideview/parallax-sky.png`;
  const middlePath = `${assetRoot}/sideview/parallax-middle.png`;
  const detailPath = '../media/detail-water-bank.png';
  let elapsed = 0, overTime = 0, sideTime = 0, tourTime = 0, last = 0;
  // Retain decoded images so changing a displayed frame reuses this release.
  const decodedImages = new Map();
  const setImage = (id, src) => {
    const element = q(`#${id}`);
    if (element.getAttribute('src') !== src) element.src = src;
  };
  function controls() {
    const disabled = !state.ready || state.reducedMotion;
    for (const id of ['playOverworld', 'playSide', 'tour']) q(`#${id}`).disabled = disabled;
    q('#reset').disabled = !state.ready;
    q('#playOverworld').textContent = state.playing ? 'Pause loop' : 'Play loop';
    q('#playSide').checked = state.sidePlaying;
    q('#tour').textContent = state.tour ? 'Stop tour' : 'Play 24-second tour';
    q('#reduced').checked = state.reducedMotion;
  }
  function draw() {
    const viewport = q('#viewport');
    Object.assign(viewport.dataset, {
      playerX: state.courierX.toFixed(2), playerY: state.courierY.toFixed(2),
      camera: state.camera.toFixed(2), frame: String(state.sideFrame), courierFrame: String(state.courierFrame),
    });
    setImage('overworld', framePath('overworld', state.overworldFrame));
    setImage('sideFull', framePath('sideview', state.sideFrame));
    setImage('sideNear', nearPath(state.sideFrame));
    setImage('sideSky', skyPath); setImage('sideMiddle', middlePath);
    setImage('panorama', framePath('sideview', 0)); setImage('waterDetail', detailPath);
    setImage('courier', framePath('courier', state.courierFrame));
    setImage('courierDetail', framePath('courier', elapsed % 2480 < 1080
      ? Math.floor(elapsed % 2480 / 180) : 6 + Math.floor((elapsed % 2480 - 1080) / 100)));
    setImage('reedling', framePath('reedling', Math.floor(elapsed / 180) % 6));
    setImage('reedlingDetail', framePath('reedling', elapsed % 1880 < 1080
      ? Math.floor(elapsed % 1880 / 180) : 6 + Math.floor((elapsed % 1880 - 1080) / 100)));
    Object.assign(q('#courier').style, {
      left: `${Math.round(state.courierX - state.camera)}px`, top: `${Math.round(state.courierY)}px`,
      transform: `scaleX(${state.facing})`, width: '32px', height: '48px',
    });
    Object.assign(q('#reedling').style, {left: `${Math.round(540 - state.camera)}px`, top: '154px', width: '40px', height: '32px'});
    q('#sideSky').style.transform = `translateX(${-Math.round(state.camera * .15)}px)`;
    q('#sideMiddle').style.transform = `translateX(${-Math.round(state.camera * .35)}px)`;
    for (const id of ['sideNear', 'sideFull']) q(`#${id}`).style.transform = `translateX(${-Math.round(state.camera)}px)`;
    q('#sideFull').style.display = 'none';
    q('#overworldStatus').textContent = `Frame ${String(state.overworldFrame + 1).padStart(2, '0')} · 100 ms`;
    q('#sideStatus').textContent = `Frame ${String(state.sideFrame + 1).padStart(2, '0')} · x ${Math.round(state.courierX)}`;
  }
  function reset() {
    Object.assign(state, {courierX: 116, courierY: 138, vy: 0, camera: 0, courierFrame: 0, tour: false, keys: {}});
    controls(); if (state.ready) draw();
  }
  function jump() {
    if (state.ready && state.courierY >= 137.9) { state.vy = -175; state.courierY = 137.9; }
  }
  q('#playOverworld').onclick = () => { if (!state.ready || state.reducedMotion) return; state.playing = !state.playing; controls(); };
  q('#playSide').onchange = event => { if (state.ready && !state.reducedMotion) state.sidePlaying = event.target.checked; };
  q('#reset').onclick = reset;
  q('#reduced').onchange = event => {
    state.reducedMotion = event.target.checked;
    state.playing = state.sidePlaying = !state.reducedMotion;
    if (state.reducedMotion) { reset(); elapsed = overTime = sideTime = 0; state.overworldFrame = state.sideFrame = 0; }
    controls(); if (state.ready) draw();
  };
  q('#tour').onclick = () => {
    if (!state.ready || state.reducedMotion) return;
    const start = !state.tour;
    reset(); state.tour = start; tourTime = 0;
    if (start) state.courierX = 32;
    controls(); draw();
  };
  const isControl = event => event.target instanceof HTMLElement && (
    event.target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(event.target.tagName)
  );
  addEventListener('keydown', event => {
    if (!state.ready || isControl(event)) return;
    const key = event.key.toLowerCase();
    if (!['arrowleft', 'arrowright', 'arrowup', ' ', 'a', 'd', 'w'].includes(key)) return;
    event.preventDefault(); state.keys[key] = true;
    if (['arrowup', 'w', ' '].includes(key) && !event.repeat) jump();
    if (!event.repeat && ['arrowleft', 'a', 'arrowright', 'd'].includes(key)) {
      const direction = ['arrowleft', 'a'].includes(key) ? -1 : 1;
      state.courierX = Math.max(0, Math.min(736, state.courierX + direction * 2));
      state.facing = direction; state.camera = Math.max(0, Math.min(512, state.courierX - 116)); draw();
    }
  });
  // Always release a held movement key, even if focus moved onto a control.
  addEventListener('keyup', event => { state.keys[event.key.toLowerCase()] = false; });
  addEventListener('blur', () => { state.keys = {}; });
  q('#retryLoad').onclick = () => location.reload();
  function tick(time) {
    const dt = Math.min((time - (last || time)) / 1000, .05); last = time;
    if (!state.reducedMotion) elapsed += dt * 1000;
    if (state.playing && !state.reducedMotion) { overTime += dt; state.overworldFrame = Math.floor(overTime * 10) % 12; }
    if (state.sidePlaying && !state.reducedMotion) { sideTime += dt; state.sideFrame = Math.floor(sideTime * 10) % 12; }
    let direction = (state.keys.arrowright || state.keys.d ? 1 : 0) - (state.keys.arrowleft || state.keys.a ? 1 : 0);
    if (state.tour && !state.reducedMotion) {
      tourTime += dt; direction = tourTime < 23 ? 1 : 0;
      if (tourTime % 4 < dt + .02 && tourTime > 1) jump();
      if (tourTime >= 24) { state.tour = false; controls(); }
    }
    state.courierX = Math.max(0, Math.min(736, state.courierX + direction * 30 * dt));
    if (direction) state.facing = direction;
    state.vy += 470 * dt; state.courierY += state.vy * dt;
    if (state.courierY >= 138) { state.courierY = 138; state.vy = 0; }
    state.camera = Math.max(0, Math.min(512, state.courierX - 116));
    state.courierFrame = state.courierY < 137.9
      ? (state.vy < -125 ? 15 : state.vy < -45 ? 16 : state.vy < 45 ? 17 : state.vy < 125 ? 18 : 19)
      : direction ? 6 + Math.floor(elapsed / 100) % 8 : state.reducedMotion ? 0 : Math.floor(elapsed / 180) % 6;
    draw(); requestAnimationFrame(tick);
  }
  async function loadArtwork() {
    const paths = [];
    for (const [name, count] of [['overworld', 12], ['sideview', 12], ['courier', 20], ['reedling', 14]])
      for (let frame = 0; frame < count; frame++) paths.push(framePath(name, frame));
    for (let frame = 0; frame < 12; frame++) paths.push(nearPath(frame));
    paths.push(skyPath, middlePath, detailPath);
    state.assetCount = paths.length;
    try {
      await Promise.all(paths.map(async src => {
        const image = new Image(); image.src = src; await image.decode(); decodedImages.set(src, image);
      }));
      draw();
      await Promise.all(Array.from(q('#artwork').querySelectorAll('img'), image => image.decode()));
      state.ready = true; state.loadState = 'ready';
      q('#artwork').hidden = false;
      q('#loadStatus').textContent = 'Artwork ready · art direction edition';
      controls(); requestAnimationFrame(tick);
    } catch {
      state.loadState = 'error'; state.ready = false; state.playing = state.sidePlaying = false;
      q('#loadStatus').textContent = 'The complete artwork could not load. Check your connection, then retry.';
      q('#retryLoad').hidden = false; controls();
    }
  }
  controls(); loadArtwork();
})();
