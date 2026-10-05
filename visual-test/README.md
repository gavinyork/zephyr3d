# `@zephyr3d/visual-test`

Pixel regression harness. Renders a fixed set of scenes deterministically across
RHI backends and compares the result against committed baselines (pixel digests;
reference images live in an external store, see "Baselines").

It exists because the rest of the test suite runs in Node and can only check
logic — maths, render-graph topology, shader codegen. None of it can tell you
whether a frame still looks right. That gap is not theoretical: deleting the
`ctx.shadowMaskTexture` write in `forward_plus_builder.ts`, or nudging the
default shadow `depthBias` from 0.003 to 0.0035, leaves all 201 render-graph
topology tests green while visibly changing every shadowed frame. This harness
catches both.

## Running

```bash
# Build the harness bundle, then run the gating (SwiftShader) projects.
npm run test

# Same, without rebuilding - use when only tests/ changed.
npm run test:only

# Against the machine's real GPU. Reports, never gates. See "Baselines" below.
npm run test:gpu

# Open the HTML report from the last run (expected/actual/diff per failure).
npm run report
```

First run on a machine needs the browser: `npm run install-browser`.

## Baselines

The gating (`-swiftshader`) projects are pinned by **pixel digests**, committed in
`digests/<project>.<convention>.json`. The reference images themselves live
outside this repository, in the public store
[`gavinyork/zephyr3d-visual-baselines`](https://github.com/gavinyork/zephyr3d-visual-baselines)
(branch `images`, one PNG per digest). Design and rationale:
`plans/visual-test-digest-baselines.md`. In short, committing PNGs made the
history grow by the whole image set every time baselines were re-accepted, and
a digest is a few dozen bytes.

How a capture is judged:

1. Its digest - SHA-256 of the row-normalised RGBA plus its size - is looked up
   among the digests accepted for the scene **on this platform**
   (`linux-x64`, `win32-x64`, ...). A hit passes without reading any image.
2. On a miss it is compared, with the scene's tolerance, against a reference
   image: this platform's primary digest, else the CI platform's (`linux-x64`).
   Within tolerance it passes as a **tolerant match**, annotated in the report;
   beyond it, it fails with expected/actual/diff attached. The reference is
   fetched over HTTP into `.baseline-cache/` on first use, with no credentials.

So a pass/fail decision never depends on the image store being reachable,
except on a miss; and a lost image only costs diagnostics. A scene that keeps
passing as a tolerant match has a stale digest - re-accept it.

SwiftShader output is byte-identical on Windows, Linux (WSL) and the GitHub
`ubuntu-latest` runner, so today every platform records the same digest. The one
exception is `oit-abuffer`, which is marked `deterministic: false` and always
goes through the tolerance comparison.

A **missing baseline is a failure**, not a prompt to write one. Silently
accepting whatever the code currently does is how a scene ends up permanently
green while testing nothing. To accept a change deliberately:

```bash
UPDATE_BASELINES=1 npm run test   # writes digests/, caches the new images
# look at the images it lists under .baseline-cache/images/ before going on
npm run baselines:push            # publish the images (needs push access)
git add digests                   # then commit
```

A baseline you did not inspect is a baseline you cannot trust. CI runs
`baselines:check` and fails a commit whose digests point at images nobody
pushed.

Other commands (`node tools/baselines.mjs` documents each):

| Command | Use |
|---|---|
| `npm run baselines:fetch` | Download every referenced image, e.g. before working offline |
| `npm run baselines:accept -- <scene> [--project <p>] [--append]` | Accept the last capture of a scene from a normal run, without re-rendering |
| `npm run baselines:update-from-ci -- <run-id>` | Accept what a CI run rendered for `linux-x64` (its `visual-captures` artifact); for a platform you cannot run locally |
| `npm run baselines:gc [-- --yes]` | Drop images no longer referenced by develop, main, tags or the working tree, and squash the store |

The `-gpu` projects keep per-machine PNGs in `baselines/*-gpu/`, git-ignored: a
real GPU differs from SwiftShader (by 1/255 on a plain clear colour) and from
other GPUs, so these can never be a shared authority. Generate your own on first
run (`UPDATE_BASELINES=1 npm run test:gpu`) for local regression detection.

## Adding a scene

1. Write it in `src/scenes/`, exporting a `VisualScene` (see `src/types.ts`).
2. Register it in `src/registry.ts`.
3. Add its name to `SCENE_NAMES` in `tests/visual.spec.ts`. The first test
   asserts the two lists match, so forgetting this fails loudly rather than
   leaving the scene silently untested.
4. `UPDATE_BASELINES=1 npm run test`, inspect the images, `npm run baselines:push`,
   commit `digests/`.

Scenes must isolate one feature. Start from `bareScene()` — no sky, no
environment light, no fog — and opt in to exactly what is under test. A shadow
baseline that also happens to pin the atmosphere model will move for reasons that
have nothing to do with shadows.

Scenes must also be pure: no wall-clock time, no `Math.random()`, no unawaited
asset loads, and that includes the engine code they exercise. The harness pins
the timestep and the frame count; it cannot pin those. Any randomness in the
engine must come from the seeded `PRNG` in `@zephyr3d/base`. (`particlesys.ts`
still calls `Math.random()` directly, which is why there are no particle scenes.)

This is not hypothetical. Until the digests went in, every sky-lit scene -
`pbr-ibl` and all water scenes - rendered differently on every run, by up to
6/255 over tens of thousands of pixels: the sky's SH projection drew its sample
directions from `Math.random()`. The old 0.02 tolerance hid it completely. An
exact digest cannot be fooled that way, which is half of why it is worth having.

## How determinism is achieved

Three engine facilities, none of them added for this harness:

- `device.setFixedFrameTime()` swaps the wall clock for a synthetic one seeded at
  0, so anything time-driven becomes a function of the frame index.
- `Application.stepFrame()` advances per-frame non-idempotent state — history
  ping-pong, frame counter, motion-vector matrices — exactly once. The run loop
  cannot guarantee that.
- TAA jitter reads `Camera._halton23[frameCounter % n]`, so it is pinned by the
  frame counter rather than by elapsed time.

The `taa-multiframe` scene is the check on all three: it accumulates across 8
stepped frames, so a stable baseline there means frame state really is advancing
once per frame and history is not leaking between scenes.

## Is the harness still working? (`npm run sensitivity`)

A visual suite can die without ever turning red — by staying green while quietly
ceasing to exercise the code it claims to cover. Green and dead look identical
from outside.

`tools/sensitivity.mjs` tests the tests. Each entry is a small edit to engine
source with a known blast radius; the script applies it, rebuilds, runs the
suite, and asserts the scenes that *should* notice actually do. An entry that
stops failing is a coverage hole that has opened up.

```bash
npm run sensitivity                  # all entries (minutes - one rebuild each)
node tools/sensitivity.mjs --list
node tools/sensitivity.mjs --only shadow-default-depth-bias
```

It is not a PR gate. Run it on a schedule, and by hand after anything that
changes baselines, tolerances, or shared scene helpers. It restores engine source
via `git checkout --` in a `finally`, and refuses to start if the files it
patches have uncommitted changes.

This is not a hypothetical safeguard — the four entries currently in it found
three real defects on their first run:

| Found | What it was |
|---|---|
| `post-tonemap-bloom` was blind to the default bloom threshold | The scene set the threshold explicitly to the same value as the default, so the default could drift freely. Now inherited. |
| `taa-multiframe` was blind to TAA jitter changes | It shipped with a loosened tolerance, added in anticipation of flakiness that was never measured and does not exist. A 1.5x jitter change showed as 4.0% of pixels at the default threshold but 0.15% at the loosened one. |
| Scenes were **not** order-independent | Chasing the above: `device.frameInfo.frameCounter` is per-device and monotonic across a whole page session, and TAA jitter indexes it, so `taa-multiframe` rendered differently depending on how many scenes ran before it. `capture.ts` now rewinds the counter per scene. The loosened tolerance had been hiding this too. |

Two habits fall out of that, both worth keeping:

- **Never loosen a tolerance in anticipation.** Loosen only after observing real
  flakiness, per scene, with the reason written down — then re-run this script to
  see what the slack cost.
- **Adding an entry means running it.** An expectation that has never been
  observed is exactly the comfortable fiction this script exists to destroy.

## Shadow scenes: a deliberate split

`shadow-defaults` looks far worse than the other shadow scenes — heavy diagonal
acne across the whole floor. That is on purpose, and the split is worth
understanding before touching any of them.

Shadow acne and filter legibility pull in opposite directions:

- **Acne is the signal that depth bias is being tested.** A bias change shows up
  as the acne pattern shifting; with no acne there is nothing to shift, and the
  change is invisible.
- **Acne is noise when comparing filters.** If every baseline is dominated by
  the same striping, what separates PCF from PCSS from ESM is buried.

This is measured, not theoretical. The first version of these scenes was
acne-heavy throughout: nudging the default `depthBias` from 0.003 to 0.0035 was
caught by six scenes — but ESM was so starved of shadow-map texels that it
rendered as a smeared mess, so its baseline pinned an artifact rather than the
filter. Retuning them (`character-small` preset, side light, ground sized to the
subject) made all five filters clean and distinguishable, and dropped detection
of that same bias change to **zero scenes**.

So the suite does both, in different scenes:

| Scene | Configured by | Tests |
|---|---|---|
| `shadow-{hard,pcf,pcss,vsm,esm}`, `shadow-csm` | `character-small` preset | the filters |
| `shadow-defaults` | engine defaults, grazing light, oversized ground | the default bias constants |

If you regenerate `shadow-defaults`, verify it still fails on a small
default-bias change before accepting the new image. Its ugliness is its job.

## Two things that are easy to get wrong

**Row order.** Both backends need the same vertical flip. That is *not* what the
readback APIs suggest — `gl.readPixels` is documented bottom-up and WebGPU's
`copyTextureToBuffer` top-down, so the obvious guess is that only WebGL needs
flipping. Measured, that is wrong: the engine renders bottom-up into the
offscreen framebuffer on both. `sanity-orientation` is the assertion — it is
deliberately asymmetric in both axes so a flip is obvious in the reference image
rather than silently baked in.

**Chromium configuration.** `playwright.config.ts` pins `channel: 'chromium'` and
the page is served over `http://127.0.0.1`. Both are load-bearing: Playwright's
default headless shell exposes `navigator.gpu` but its `requestAdapter()` always
resolves to null, and WebGPU is only exposed in a secure context, which
`about:blank` (opaque origin) is not.

## Structure

```
src/          in-page: engine bootstrap, capture, scene definitions
tests/        Node side: Playwright specs, digest judgement, pixelmatch comparison
tools/        static server, sensitivity check, baselines.mjs (image store commands)
digests/      committed SwiftShader digests, one file per project and convention
baselines/    per-machine real-GPU PNGs (*-gpu/, git-ignored)
.baseline-cache/  git-ignored: fetched reference images, pending uploads, captures
```
