# Original native playback/export corpus

All fixture art, Lua scripts, C++ oracle adapter and generator scripts in this
folder are original and dedicated to CC0 1.0. Native outputs are renders/data of
that original art. No upstream test art, application binary or proprietary
application source is redistributed.

Native version: official Aseprite v1.3.18.5 source release, compiled locally on
macOS arm64; reports 1.3.18.5-dev. The C++ adapter links the separately MIT
Document Library and calls public `doc::Playback`; runtime code is not read or
called by the oracle. `playback-vectors.json` contains 1,220 independent result
sequences. The tag order passed into the oracle is insertion order; native
`Tags::add` determines playback ordering.

Each oracle input line is:
`frameCount tagCount mode start activeTagIndex steps delta forward`, then
`from to direction repeat` for every tag (zero-based ranges). Directions are
0 forward, 1 reverse, 2 pingpong, 3 pingpong_reverse. Modes are 0 all, 1 loop,
2 without-tags, 3 once, 4 stopped. Output samples state before each step as
`frame,stopped,tagIndex` (tagIndex '-' means no active tag).

The `.aseprite` inputs were produced by the adjacent original Lua sources.
RGB red-channel frame numbers identify native output order; frame delays identify
duration preservation. `cli-vectors.json`, `cli-more-vectors.json`, and
`cli-scope-vectors.json` record exported frames. `exports/` retains all native
GIF/PNG outputs, including the cross-boundary cases deliberately rejected by
strict PixelWall export traversal. GIF frames must be composited cumulatively:
transparent GIF deltas may represent repeated unchanged frames.

Reproduction from repository root:
1. Build official Aseprite v1.3.18.5 source; set `ASEPRITE_BIN` to its executable.
2. Compile `oracle.cpp` against the built public doc-lib and dependencies; set
   `ASEPRITE_PLAYBACK_ORACLE` to that executable. See the build example below.
3. Run the native batch executable with `--script-param directory=tests/fixtures/tag-traversal`
   and `--script tests/fixtures/tag-traversal/source.lua` to regenerate 16 sources.
4. Run `node tests/fixtures/tag-traversal/generate-playback.mjs`.
5. Run `probe-cli.mjs`, `probe-more.mjs`, and `probe-scope.mjs` from this folder,
   passing their full paths to Node from repository root. The latter two scripts
   also generate their own additional native inputs.
6. Run `node --test tests/frame-traversal.test.mjs`.

Example oracle build (substitute your source, build and Skia directories):

```
clang++ -std=c++17 -O2 -DNDEBUG -I$ASEPRITE_SOURCE/src -I$ASEPRITE_SOURCE/laf \
  -I$ASEPRITE_BUILD/laf -I$ASEPRITE_BUILD -I$ASEPRITE_SOURCE/third_party \
  tests/fixtures/tag-traversal/oracle.cpp -L$ASEPRITE_BUILD/lib \
  -ldoc-lib -llaf-gfx -llaf-base -lfixmath-lib -lfmt -lobs -lcityhash -lz \
  $SKIA_BUILD/libskia.a -framework CoreFoundation -o /tmp/playback-oracle
```

Original source release:
https://github.com/aseprite/aseprite/releases/tag/v1.3.18.5
Document Library license and API:
https://github.com/aseprite/aseprite/blob/v1.3.18.5/src/doc/LICENSE.txt
https://github.com/aseprite/aseprite/blob/v1.3.18.5/src/doc/playback.h
CC0 dedication:
https://creativecommons.org/publicdomain/zero/1.0/

`manifest.json` records SHA-256 hashes of the evidence and scripts. Generated
state expected values always come from the C++ native oracle, independently of
JavaScript comparisons printed by the generator.
