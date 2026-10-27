# Workflow profile notes

These are two single measured passes over the same six fixed fixtures. They are diagnostic samples, not a benchmark or a speed claim. The profiler requests GC between fixtures when launched with `--expose-gc`, and reports sampled process memory rather than an allocation trace or browser heap measurement.

Machine and runtime for both passes: macOS Darwin, arm64, Node `v25.1.0`. The baseline commit was `b1c5b0d`; the current source commit recorded by the profiler was `751f26b`.

Raw results:

- [baseline profile](benchmarks/workflow-before.json)
- [current profile](benchmarks/workflow-after.json)

## Method

```sh
node --expose-gc scripts/profile-workflows.mjs \
  --root=/Volumes/DevStorage/Builds/pixelwall/workflow-reliability/baseline \
  --out=/Volumes/DevStorage/Builds/pixelwall/workflow-reliability/profile-before.json
node --expose-gc scripts/profile-workflows.mjs \
  --root=/Volumes/DevStorage/Builds/pixelwall/workflow-reliability/source \
  --out=/Volumes/DevStorage/Builds/pixelwall/workflow-reliability/profile-after.json
```

The fixtures cover small sprite detail, linked 12-frame animation, a 512×384 regional recolor, and 64/256/512 fill workloads. Each records capture, raster, history commit, serialization, reopen, export, sampled memory, and cancellation-boundary behavior.

## What the samples suggest

Raster work is the clear dominant phase for the large fill fixtures: the 512×512 case measured about 86 seconds in the baseline pass and 70 seconds in the current pass, while serialization, reopen, and export were each hundreds of milliseconds or less. The 256×256 fill shows the same shape at roughly 15.6 seconds versus 9.0 seconds. This points future investigation toward command/raster batching and progress reporting during long raster work, not toward the checkpoint serializer first.

The 512×384 regional recolor also spends most of its time in rasterization (about 1.48 seconds baseline, 1.06 seconds current); serialization and export remain below 150 ms in the samples. The linked-animation fixture is likewise raster-dominated, though its absolute time is much smaller.

Sampled peak RSS was highest for the 512×512 fill (about 263 MB baseline and 247 MB current). This is a sizing signal for bounded progress/memory reporting, not a claim of peak allocation or a production limit.

Cancellation checks preserved the original document and did not commit the staged batch in every fixture. Boundary times varied substantially with workload; the profiler records them so future runs can compare behavior under repeated measurements.

Because each fixture was measured once per checkout on a live development machine, these observations should be repeated before publishing performance numbers or selecting an optimization target.
