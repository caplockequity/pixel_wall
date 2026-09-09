/*!
 * Modified JavaScript adaptation of Aseprite Document Library playback.cpp,
 * playback.h and tag ordering from tags.cpp (v1.3.18.5).
 * Copyright (c) 2021-2024 Igara Studio S.A.
 * Copyright (c) 2001-2018 David Capello
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE. Full origin and modification notes: docs/playback-NOTICES.txt.
 */

const MODES = ['all', 'loop', 'without-tags', 'once', 'stopped'];
const DIRECTIONS = ['forward', 'reverse', 'pingpong', 'pingpong_reverse'];
const FRAME_LIMIT = 32768, TAG_LIMIT = 1024, WORK_LIMIT = 1048576;
const fail = message => { throw new Error(message); };
const integer = (value, min, max, label) => Number.isSafeInteger(value) && value >= min && value <= max ? value : fail(`${label} must be an integer from ${min} to ${max}.`);
const pingpong = tag => tag.direction === 'pingpong' || tag.direction === 'pingpong_reverse';
const contains = (tag, frame) => frame >= tag.from && frame <= tag.to;

/** Stateful, allocation-bounded native tag traversal; indices are zero-based.
 * all = finite export, loop = editor loop, without-tags = timeline loop,
 * once = one traversal (ignores subtags/repeat counts), stopped = no movement.
 * An active tag in loop mode repeats indefinitely, as in native editor playback.
 * next(delta) is bounded to 32768 steps per call. Snapshots are detached values.
 */
export function createFramePlayback({ frameCount, tags = [], initialFrame = 0, mode = 'loop', activeTagId = null, forward = 1 } = {}) {
  frameCount = integer(frameCount, 1, FRAME_LIMIT, 'Frame count');
  initialFrame = integer(initialFrame, 0, frameCount - 1, 'Initial frame');
  if (!MODES.includes(mode)) fail('Unknown playback mode.');
  if (forward !== 1 && forward !== -1) fail('Playback direction must be 1 or -1.');
  if (!Array.isArray(tags) || tags.length > TAG_LIMIT) fail(`Playback supports at most ${TAG_LIMIT} tags.`);
  const ids = new Set();
  tags = tags.map((tag, i) => {
    const id = tag.id ?? String(i);
    if ((typeof id !== 'string' && !Number.isSafeInteger(id)) || ids.has(id)) fail('Playback tag IDs must be unique strings or integers.');
    ids.add(id);
    const from = integer(tag.from, 0, frameCount - 1, 'Tag first frame');
    const to = integer(tag.to, from, frameCount - 1, 'Tag last frame');
    if (!DIRECTIONS.includes(tag.direction ?? 'forward')) fail('Unknown tag direction.');
    return { id, from, to, direction: tag.direction ?? 'forward', repeat: integer(tag.repeat ?? 0, 0, 65535, 'Tag repeat') };
  }).sort((a, b) => a.from - b.from || b.to - a.to);
  const active = activeTagId == null ? null : tags.find(tag => tag.id === activeTagId);
  if (activeTagId != null && !active) fail('Unknown active playback tag.');
  let frame = initialFrame, playMode = mode, work = 0;
  const playing = [], played = new Set();
  function tick() { if (++work > WORK_LIMIT) fail('Tag traversal exceeds the per-step work limit.'); }
  const current = () => playing.at(-1);
  const tag = () => current()?.tag;
  const parentForward = () => current()?.forward ?? forward;
  const first = t => current().forward < 0 ? t.to : t.from;
  const last = t => current().forward > 0 ? t.to : t.from;
  function stop() { if (playMode === 'all' || playMode === 'once') frame = initialFrame; playMode = 'stopped'; }
  function add(t, rewind, direction) {
    tick();
    if (playing.length >= TAG_LIMIT) fail('Tag traversal stack exceeds its limit.');
    const item = { tag: t, forward: direction * (t.direction === 'forward' || t.direction === 'pingpong' ? 1 : -1), repeat: t.repeat > 0 ? t.repeat : pingpong(t) ? 2 : 1, rewind, delayedDelete: null, removeThese: [] };
    if (rewind) {
      let delayed = current();
      while (delayed.delayedDelete) { tick(); delayed = delayed.delayedDelete; }
      delayed.delayedDelete = item;
      item.removeThese.push(...delayed.removeThese, delayed.tag);
      delayed.removeThese.length = 0;
      let at = playing.length - 1;
      while (at > 0 && playing[at].tag !== delayed.tag) { tick(); --at; }
      playing.splice(at, 0, item);
    } else playing.push(item);
    played.add(t);
  }
  function enter(delta, firstTime, depth = 0) {
    tick();
    if (depth > 128) fail('Tag traversal nesting exceeds 128 levels.');
    if (playMode !== 'all' && playMode !== 'loop') return;
    const active = tag(), enteringFrame = frame, direction = parentForward();
    for (const t of tags) {
      tick();
      if (!contains(t, enteringFrame) || played.has(t)) continue;
      if (active && (active.to < t.to || active.from > t.from)) add(t, true, 1);
      else {
        add(t, false, direction);
        if (!firstTime) {
          frame = first(t);
          if (enteringFrame !== frame) enter(delta, false, depth + 1);
        }
      }
    }
  }
  function decrement(delta) {
    while (true) {
      tick();
      const t = tag(), item = current();
      if (!item) fail('Invalid tag traversal state.');
      if (item.repeat > 1) {
        --item.repeat;
        frame = first(t);
        return t.to > t.from;
      }
      if (!item.delayedDelete) {
        for (const other of item.removeThese) played.delete(other);
        played.delete(t);
      }
      playing.pop();
      const direction = parentForward();
      let next = current()?.rewind ? first(tag()) : delta * direction < 0 ? t.from - 1 : t.to + 1;
      if (next < 0 || next >= frameCount) {
        if (playMode === 'all') { stop(); return false; }
        if (next < 0) {
          if (!current()) next = frameCount - 1;
          else if (current().repeat > 1) {
            if (tag().direction === 'pingpong_reverse') current().forward *= -1;
            --current().repeat;
            next = t.to + 1;
          } else continue;
        } else {
          if (!current() && t.direction === 'pingpong_reverse' && t.from === 0 && t.to === frameCount - 1) {
            frame = frameCount - 1;
            enter(delta, false);
            if (playing.length > 1) { current().forward *= -1; frame = first(tag()); }
            return false;
          }
          if (current() && t.to === tag().to) {
            if (current().repeat <= 1) continue;
            if (pingpong(tag())) { current().forward *= -1; next = t.from - 1; }
            else if (tag().direction === 'forward') { --current().repeat; next = tag().from; }
            else next = 0;
          } else next = 0;
        }
      }
      frame = next;
      if (tag()) { if (contains(tag(), frame)) return false; }
      else {
        if (playMode === 'loop' && pingpong(t) && t.from === 0 && t.to === frameCount - 1) add(t, false, parentForward());
        return false;
      }
    }
  }
  function exit(delta) {
    tick();
    if (playMode === 'all' || playMode === 'loop') {
      const t = tag();
      if (t && contains(t, frame)) {
        if (!pingpong(t) && delta > 0 && frame === last(t)) { decrement(delta); return false; }
        if (pingpong(t) && frame === last(t)) { current().forward *= -1; return decrement(delta); }
        if (playMode === 'loop') {
          if (delta < 0 && frame === first(t)) { frame = last(t); return false; }
          return true;
        }
        return true;
      }
      if (delta > 0 && ((frame === frameCount - 1 && forward > 0) || (frame === 0 && forward < 0))) {
        if (playMode === 'loop') frame = forward > 0 ? 0 : frameCount - 1;
        else stop();
        return false;
      }
      if (delta < 0 && ((frame === 0 && forward > 0) || (frame === frameCount - 1 && forward < 0))) {
        if (playMode === 'loop') frame = forward > 0 ? frameCount - 1 : 0;
        else stop();
        return false;
      }
    } else if (playMode === 'once') {
      const t = tag(), direction = parentForward();
      if (t) {
        if ((t.direction === 'forward' && frame === t.to) || (t.direction === 'reverse' && frame === t.from) || (t.direction === 'pingpong' && frame === t.from && direction < 0) || (t.direction === 'pingpong_reverse' && frame === t.to && direction > 0)) { stop(); return false; }
        if ((t.direction === 'pingpong' && frame === t.to && direction > 0) || (t.direction === 'pingpong_reverse' && frame === t.from && direction < 0)) current().forward *= -1;
      } else if ((delta > 0 && frame === frameCount - 1) || (delta < 0 && frame === 0)) { stop(); return false; }
    }
    return true;
  }
  function snapshot() { return { frame, stopped: playMode === 'stopped', tagId: tag()?.id ?? null }; }
  if (mode === 'once') {
    if (active) { frame = active.direction === 'reverse' || active.direction === 'pingpong_reverse' ? active.to : active.from; add(active, false, 1); }
    else frame = 0;
  } else if (mode === 'loop' && active) { add(active, false, 1); current().repeat = Infinity; }
  enter(initialFrame, true);
  return Object.freeze({
    snapshot,
    stop() { stop(); return snapshot(); },
    next(delta = 1) {
      integer(delta, -FRAME_LIMIT, FRAME_LIMIT, 'Playback step');
      work = 0;
      const step = delta > 0 ? 1 : -1;
      while (delta !== 0 && playMode !== 'stopped') {
        if (exit(step)) {
          if (playMode === 'without-tags') frame = (frame + step + frameCount) % frameCount;
          else if (playMode !== 'stopped') frame += step * parentForward();
        }
        enter(step, false);
        delta -= step;
      }
      return snapshot();
    },
  });
}

/** Collect a finite traversal without allocating an unbounded expanded repeat list. */
export function collectPlaybackFrames(options, { maxFrames = FRAME_LIMIT } = {}) {
  integer(maxFrames, 1, FRAME_LIMIT, 'Maximum output frames');
  if (options.mode !== 'all' && options.mode !== 'once') fail('Finite collection requires all or once playback mode.');
  const playback = createFramePlayback(options), frames = [];
  for (let state = playback.snapshot(); !state.stopped; state = playback.next()) {
    if (state.frame < 0 || state.frame >= options.frameCount) fail('Native traversal leaves the frame range for this configuration.');
    if (frames.length >= maxFrames) fail('Animation traversal exceeds the maximum output frame count.');
    frames.push(state.frame);
  }
  return frames;
}

/** Convert contiguous timeline tags; old discontiguous PixelWall clips have no native range. */
export function documentPlaybackTags(document) {
  const byId = new Map(document.frames.map((frame, i) => [frame.id, i]));
  return (document.clips ?? []).flatMap(clip => {
    const indices = clip.frameIds.map(id => byId.get(id));
    if (!indices.length || indices.some((index, i) => !Number.isInteger(index) || (i > 0 && index !== indices[i - 1] + 1))) return [];
    return [{ id: clip.id, from: indices[0], to: indices.at(-1), direction: clip.direction ?? 'forward', repeat: clip.repeat ?? (clip.loop === false ? 1 : 0) }];
  });
}

/** Legacy clips keep their explicit frame list and previous endpoint convention. */
export function legacyClipFrames(document, clip) {
  const byId = new Map(document.frames.map((frame, index) => [frame.id, index]));
  let indices = clip.frameIds.map(id => byId.get(id));
  if (indices.some(index => !Number.isInteger(index))) fail('Clip references an unknown frame.');
  if (clip.direction === 'reverse' || clip.direction === 'pingpong_reverse') indices.reverse();
  if (pingpong(clip)) indices = [...indices, ...indices.slice(1, -1).reverse()];
  return indices;
}

/** Finite native --play-subtags traversal. With false, selection order is unchanged.
 * An explicit selected range bypasses this helper in the CLI, matching native.
 * clipScope:'contained' is a deliberate UI policy: traverse only tags fully inside
 * the selected clip. The default rejects cross-boundary scopes whose native CLI
 * output is not a clean traversal of the selected frames.
 */
export function exportFrameTraversal(document, { clip = null, playSubtags = false, maxFrames = FRAME_LIMIT, clipScope = 'strict', legacyDirection = true } = {}) {
  integer(maxFrames, 1, FRAME_LIMIT, 'Maximum output frames');
  if (!['strict', 'contained'].includes(clipScope)) fail('Unknown clip traversal scope.');
  const tags = documentPlaybackTags(document), selected = clip && tags.find(tag => tag.id === clip.id);
  if (clip && !selected) {
    const indices = legacyDirection ? legacyClipFrames(document, clip) : clip.frameIds.map(id => document.frames.findIndex(frame => frame.id === id));
    if (indices.length > maxFrames) fail('Animation traversal exceeds the maximum output frame count.');
    return indices;
  }
  const from = selected?.from ?? 0, to = selected?.to ?? document.frames.length - 1;
  if (!playSubtags) return Array.from({ length: to - from + 1 }, (_, i) => from + i);
  let relevant = tags.filter(tag => tag.to >= from && tag.from <= to);
  if (selected && relevant.some(tag => tag.from < from || tag.to > to)) {
    if (clipScope === 'strict') fail('Subtag export cannot scope tags crossing the selected tag boundary. Select the full timeline, use an explicit frame range, or disable --play-subtags.');
    relevant = relevant.filter(tag => tag.from >= from && tag.to <= to);
  }
  // A transparent leading sentinel enters the first real frame through next(),
  // allowing reverse/nested tags to choose their first frame, unlike an editor
  // cursor which intentionally begins at its current frame.
  const playback = createFramePlayback({ frameCount: to - from + 2, initialFrame: 0, mode: 'all', tags: relevant.map(tag => ({ ...tag, from: tag.from - from + 1, to: tag.to - from + 1 })) });
  const frames = [];
  for (let state = playback.next(); !state.stopped; state = playback.next()) {
    if (state.frame < 1 || state.frame > to - from + 1) fail('Native traversal leaves the selected frame range.');
    if (frames.length >= maxFrames) fail('Animation traversal exceeds the maximum output frame count.');
    frames.push(state.frame);
  }
  return frames.map(frame => from + frame - 1);
}

/** UI playback adapter: native stateful stepping with legacy discontiguous fallback.
 * loop defaults to the clip's existing PixelWall loop setting. Finite UI playback
 * uses export traversal with contained subtags; loop mode uses native active-tag
 * semantics (the active tag repeats forever; subtags keep their repeat counts).
 */
export function createDocumentPlayback(document, { clip = null, initialFrameId = document.frames[0]?.id, loop = clip?.loop !== false, maxFrames = FRAME_LIMIT } = {}) {
  const initial = document.frames.findIndex(frame => frame.id === initialFrameId);
  if (initial < 0) fail('Unknown initial playback frame.');
  const tags = documentPlaybackTags(document), native = !clip || tags.some(tag => tag.id === clip.id);
  if (native && loop) {
    const start = clip && !clip.frameIds.includes(initialFrameId) ? document.frames.findIndex(frame => frame.id === clip.frameIds[0]) : initial;
    const playback = createFramePlayback({ frameCount: document.frames.length, tags, initialFrame: start, activeTagId: clip?.id, mode: 'loop' });
    const translate = state => {
      if (!document.frames[state.frame]) fail('Native playback moved outside the document.');
      return { ...state, frameId: document.frames[state.frame].id };
    };
    return Object.freeze({ snapshot: () => translate(playback.snapshot()), next: () => translate(playback.next()), stop: () => translate(playback.stop()) });
  }
  const frames = exportFrameTraversal(document, { clip, playSubtags: true, clipScope: 'contained', maxFrames });
  if (!frames.length) fail('No frames to play.');
  let index = loop ? Math.max(0, frames.indexOf(initial)) : 0, stopped = false;
  const snapshot = () => ({ frame: frames[index], frameId: document.frames[frames[index]].id, stopped, tagId: clip?.id ?? null });
  return Object.freeze({ snapshot, stop() { stopped = true; return snapshot(); }, next() { if (!stopped) { if (index + 1 >= frames.length && !loop) stopped = true; else index = (index + 1) % frames.length; } return snapshot(); } });
}
