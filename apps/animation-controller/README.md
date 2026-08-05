# Animation Controller

Interactive AnimationController example with retargeted humanoid animations.

The demo loads a skinned humanoid model, retargets separate action files onto
that model, creates upper/lower body masked clips, then drives them through a
controller state graph.

Default URL parameters:

- `model`
- `idle`
- `walk`
- `run`
- `shoot`
- `attack`

Example:

```text
dist/index.html?model=/assets/character.glb&idle=/assets/idle.glb&run=/assets/run.glb
```

Key APIs:

- `AnimationSet.copyHumanoidAnimationFrom()`
- `AnimationSet.createSkeletalMaskedAnimation()`
- `new AnimationController()`
- `controller.addState()`
- `controller.dispatch()`
- timeline `waitMarker`, `emit`, `enqueue`, and `returnTo`
