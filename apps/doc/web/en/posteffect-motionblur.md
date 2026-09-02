# Motion Blur

Motion Blur uses the camera motion-vector buffer to blur fast camera or object motion after the main scene render.

It is useful for racing, fast camera moves, high-speed projectiles, and cinematic transitions. Avoid strong values in UI-heavy scenes or precise inspection tools, because it can reduce readability.

## Enable Motion Blur

```ts
camera.motionBlur = true;
camera.motionBlurStrength = 0.8;
```

Properties:

| Property | Type | Meaning |
| --- | --- | --- |
| `camera.motionBlur` | `boolean` | Enables or disables the effect |
| `camera.motionBlurStrength` | `number` | Blur intensity multiplier; default is `1` |

## Runnable Example

```js
camera.motionBlur = true;
camera.motionBlurStrength = 1.0;
```

<div class="showcase" case="tut-73" style="width:600px;height:500px"></div>

