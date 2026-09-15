<!--
Thanks for the pull request. Two things that make one land much faster:

  1. Target the `develop` branch, not `main`.
  2. If this is a large change or touches public API, link the issue or Discussion where the
     approach was agreed. Unannounced large PRs usually cannot be accepted — see CONTRIBUTING.md.

Please delete the parts of this template that do not apply.
-->

## What this changes

<!-- One or two sentences. What was wrong or missing, and what the change does about it. -->

## Why this way

<!--
Only if the approach is not obvious. If you considered an alternative and rejected it, say why —
that is usually the most useful paragraph in a pull request.
-->

## Backends

<!-- Delete those that do not apply. If a feature only works on some backends, say so explicitly. -->

- [ ] WebGPU
- [ ] WebGL2
- [ ] WebGL1
- [ ] Backend-independent (docs, build, tooling)

## How it was verified

<!--
Delete what does not apply. "Builds clean" is not verification for a rendering change.
-->

- [ ] Unit tests pass (`rush test`)
- [ ] Visual regression tests pass (`visual-test`, built first — see CONTRIBUTING.md)
- [ ] Baselines updated (`npm run test:update`), and I looked at the diffs
- [ ] Manually verified on: <!-- e.g. Chrome 141 / WebGPU / RTX 4070 -->

If visual baselines changed, describe what moved and why the new pixels are the correct ones:

## Checklist

- [ ] Targets `develop`
- [ ] Commit messages are one line, no signature
- [ ] Change file added for touched `@zephyr3d/*` packages (`rush change`)
- [ ] Documentation updated if behaviour or public API changed
