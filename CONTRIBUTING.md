# Contributing to Zephyr3D

Thanks for taking the time. Zephyr3D is maintained by one person, and this document is written to
save you from spending a weekend on a pull request that was never going to land. Read it before
you open one — it is short, and it is honest about what this project is right now.

## Where the project is

Zephyr3D is **pre-1.0 and APIs still change between minor versions**. That has two consequences for
contributors:

- Large, refactor-shaped pull requests are very hard to accept. They conflict with private branch
  work, and any API they touch may already be mid-change. Open an issue or a Discussion first and
  agree on the shape before you write the code.
- The author is one person, working in their free time. An issue or PR may sit for a week or two.
  This is not a signal that it was ignored.

The most valuable contributions right now are **bug reports with reproductions**, **documentation
corrections**, and **small, self-contained fixes** — not new subsystems.

## Reporting a bug

Rendering bugs are hard to act on without context. A useful report includes:

- What you expected and what you got.
- **Which backend**: WebGL1, WebGL2 or WebGPU. The engine falls back silently when a capability is
  missing, so "it works on my laptop" often means a different backend ran.
- Your GPU and driver, and the browser version.
- A minimal reproduction. A failing code snippet, or a scene you can share, is worth more than a
  paragraph of description. If you can attach a screenshot, do.
- If it is a pixel-level difference, say whether it is new since a specific version — that alone
  narrows it enormously.

For anything you are not sure is a bug, or any "how do I do X" question, use
[Discussions](https://github.com/gavinyork/zephyr3d/discussions) rather than the issue tracker.

## Setting up

The monorepo uses [Rush](https://rushjs.io/) with pnpm. You do not need Rush installed globally.

Requirements: **Node >= 20** and **pnpm 10.23.0** (Rush installs its own pnpm; you generally do not
need it on PATH).

```bash
# install and link all packages
node common/scripts/install-run-rush.js update

# build everything
node common/scripts/install-run-rush.js rebuild --verbose
```

Everything goes through `install-run-rush.js` — it bootstraps the pinned Rush version for you.

## Running the tests

```bash
# unit tests (jest) - maths, render-graph topology, serialization, shader codegen
node common/scripts/install-run-rush.js test
```

These are gating in CI, not advisory. Run them before you push.

### Visual regression tests

The pixel tests live in `visual-test/` and run against committed baselines rendered under
SwiftShader.

```bash
npm run install-browser --prefix ./visual-test   # once; needs the full Chromium build

# IMPORTANT: build the engine AND the harness bundle first
node common/scripts/install-run-rush.js build -t @zephyr3d/visual-test --verbose
npm run test:only --prefix ./visual-test
```

**Build before you test.** The harness bundle consumes the built engine output, not the TypeScript
source. If you run the tests against a stale bundle, you will see large numbers of failures that
have nothing to do with your change — most often on shadow scenes. `npm run test` (without
`:only`) does the build for you; `test:only` deliberately does not.

Baselines are updated with `npm run test:update --prefix ./visual-test`. Only do this when you have
looked at the diff and are confident the new output is correct — a baseline update commits the new
pixels as the definition of correct.

There are also `test:gpu` projects that run on your real GPU instead of SwiftShader. They are not
part of the CI gate; use them to confirm something that only reproduces on hardware.

## Code style

Formatting is Prettier with the repo's config: **110-column print width, single quotes, no trailing
commas, semicolons**. `.editorconfig` handles line endings. Lint is ESLint per package:

```bash
npm run lint --prefix ./visual-test      # or the equivalent in the package you touched
```

Comments in this codebase explain *why*, not *what*, and they assume the reader knows graphics.
Match that. A comment restating the line below it will be removed.

## Branches and commits

- Branch off **`develop`** and target `develop` in your pull request. `main` is the release branch.
- Commit messages are **one short line, no body, no signature**:
  `fix: clamp terrain layer index to valid range`
- Keep history clean enough to review. Squashing is fine.

## Change files

The repo uses Rush change files for versioning. If your change touches a published `@zephyr3d/*`
package, add one:

```bash
node common/scripts/install-run-rush.js change --target-branch develop
```

Pick the packages and bump level (`patch` / `minor` / `major`) and write a short description. Pure
documentation, CI and example changes usually do not need one. If in doubt, add it — an extra
change file is easy to drop, a missing one breaks the release.

## Licensing

Zephyr3D is MIT licensed. By submitting a contribution you agree it is licensed under the same
terms — there is no separate CLA to sign.

## What will probably not be merged

Saying this up front is fairer than rejecting it after you have written it:

- **New features that were not discussed first.** Open an issue. A feature that fits the roadmap
  may well be welcome; one that arrives unannounced and changes public API almost never is.
- **Style-only or reformatting pull requests** that touch large parts of the tree.
- **Dependency additions.** The engine ships to the browser and cares about bundle size. A new
  runtime dependency needs a strong argument, and a suggestion is more likely to land than a patch.
- **New renderer features that only work on one backend** without saying so. The capability system
  and the documentation are explicit about per-backend limits; a feature that silently does nothing
  on WebGL2 is a bug, not a feature.
