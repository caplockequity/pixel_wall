# Animation tag traversal

The shared `app/frame-traversal.mjs` adapts the separately MIT-licensed Aseprite
Document Library playback state machine. It is verified against a local official
v1.3.18.5 build, using an independent C++ caller of the public `doc::Playback`
API and native CLI exports of original 1-pixel animations.

## Verified distinctions

| Operation | Directions/repeats/subtags |
| --- | --- |
| Native CLI `--tag clip --save-as animation.gif` | Select frames; timeline order, no repeats |
| Native CLI `--play-subtags --tag clip --save-as animation.gif` | Finite traversal with directions, repeats and nested tags |
| PNG/BMP/TGA sequence with `--play-subtags` | Uses the same finite traversal |
| Sheet/atlas/ZIP atlas | Timeline order; `--play-subtags` does not expand entries |
| Explicit `--frame-range` or PixelWall `--frame` | Explicit frame selection bypasses traversal |
| Editor loop with active tag | Active tag loops indefinitely; nested tags honor repeats |
| Finite UI preview | Finite traversal, then stops on the last displayed frame |

Plain selected-tag GIF exports previously applied direction implicitly in
PixelWall. They now follow native CLI timeline ordering. Add `--play-subtags` to
request direction/repeat traversal. Legacy discontiguous PixelWall animation
clips keep their explicit list, direction, and previous ping-pong convention.
There was no implemented CLI `--direction` override to remove.

For a tag containing frames `1,2,3`:

| Direction | repeat=0 | repeat=1 | repeat=2 | repeat=3 |
| --- | --- | --- | --- | --- |
| forward | 1,2,3 | 1,2,3 | 1,2,3,1,2,3 | 1,2,3,1,2,3,1,2,3 |
| reverse | 3,2,1 | 3,2,1 | 3,2,1,3,2,1 | 3,2,1,3,2,1,3,2,1 |
| pingpong | 1,2,3,2,1 | 1,2,3 | 1,2,3,2,1 | 1,2,3,2,1,2,3 |
| pingpong_reverse | 3,2,1,2,3 | 3,2,1 | 3,2,1,2,3 | 3,2,1,2,3,2,1 |

Repeat 0 means unspecified/forever during playback; finite exports use one
forward/reverse pass or both ping-pong directions. A ping-pong repeat is a leg,
not an entire round trip. One-frame tags retain repeat timing. GIF container
loop count remains controlled separately by `--loop`; it is not the tag repeat
count. Source frame durations accompany every traversed frame.

The CLI flag is scoped per input when `--ordered-inputs` is enabled:

```sh
pixelwall export hero.aseprite --tag idle --play-subtags --format gif --out idle.gif --license license.txt
pixelwall export hero.aseprite --play-subtags --format png --out-dir animation-frames
pixelwall export --ordered-inputs --play-subtags hero.aseprite --play-subtags=false enemy.aseprite --format gif --out-dir animations --license license.txt
```

## API and limits

`createFramePlayback({frameCount,tags,initialFrame,mode,activeTagId,forward})`
returns `snapshot()`, `next(delta=1)` and `stop()`. A snapshot is
`{frame, stopped, tagId}`. Frame indices and tag ranges are zero-based;
`tags` contain `{id,from,to,direction,repeat}`. Supported modes are `all`,
`loop`, `without-tags`, `once`, `stopped`, matching the native public modes.
`all`/`once` restore the initial cursor when stopped. The selected tag in
`loop` mode repeats indefinitely. The `once` primitive retains native behavior;
its one-frame ping-pong edge can leave the range, so document finite previews
use bounded `all` traversal instead.

`collectPlaybackFrames(options,{maxFrames})` collects only finite `all`/`once`
modes, rejects out-of-range states, and rejects expansions exceeding the limit.
`exportFrameTraversal(document,{clip,playSubtags,clipScope,maxFrames})` starts
through a leading sentinel so reverse/nested tags choose their initial export
frame. The sentinel is never an output frame. It does not mutate the document.

`createDocumentPlayback(document,{clip,initialFrameId,loop,maxFrames})` returns
stateful `snapshot()`, `next()`, `stop()` with `frameId` added. Continuous native
playback streams frames without allocating an infinite array. Discontiguous
clips retain their legacy behavior. `documentPlaybackTags(document)` converts
contiguous forward-ordered clip lists to native ranges; other clips remain
legacy clips.

Bounds: 32,768 frame indices per generic playback domain (including the export
sentinel), 1,024 tags, 65,535 repeats, 32,768 steps per `next` call, 128 recursive
entry levels, 1,048,576 work units per call, and 32,768 finite output frames.
The existing planner additionally enforces aggregate entry/pixel budgets.
Bounds errors are explicit and no document is changed. Documents supplied to
adapters must already be normalized by the editor.

For selected-tag exports, native v1.3.18.5 can repeat stale/last pixels when
other tags extend beyond the selected tag. Strict CLI traversal rejects that
scope, with instructions to export the full timeline, use a frame range, or
turn traversal off. Full-timeline overlapping tags are supported. The explicit
`clipScope:'contained'` UI policy excludes ancestor/crossing tags and traverses
only the selected clip and its fully contained tags; it does not claim exact
native behavior for those problematic selected export scopes.

## Evidence and attribution

The original native corpus lives in `tests/fixtures/tag-traversal/`. Its 1,220
state-machine cases include all four directions, repeats 0–3, active tags,
negative stepping, all five modes, single frames, nested/overlapping tags, and
stopped states. CLI vectors cover default/opt-in GIF, PNG sequences, sheets,
frame ranges, full-range reverse tags, one-frame repeats, and contained subtags.
The tests preserve frame indices and durations independently of the JavaScript
implementation. Fixtures and generators are CC0; the adapted engine is MIT.
`playback-NOTICES.txt` is copied into browser, desktop and CLI runtime bundles.

Primary sources: [Tag repeats](https://www.aseprite.org/api/tag#tagrepeats),
[CLI options](https://www.aseprite.org/docs/cli/),
[public playback API](https://github.com/aseprite/aseprite/blob/v1.3.18.5/src/doc/playback.h).

## Integrated editor behavior

The editor uses a stateful cursor for playback, schedules each frame's own duration and cancels the cursor/timer when playback stops or the document changes. The Repeats field updates both native repeat count and finite/continuous preview behavior; 0 means continuous. For ping-pong, each direction counts as a repeat.

GIF export opts into finite traversal for the selected clip and its fully contained subtags. Sheet and game-package atlases retain timeline membership order. Current-frame and editable-project exports bypass traversal, so a large valid repeat count does not prevent saving a project. Host tests execute the actual playback effect and export functions, checking native frame order/timing, GIF pixels, timer cleanup, bounded failure and original project preservation.

Actual rebuilt browser verification displayed a three-repeat ping-pong clip in the editor, started it, and observed automatic stopping. Exact sequence/timing assertions remain in the independent engine and extracted-host tests.
