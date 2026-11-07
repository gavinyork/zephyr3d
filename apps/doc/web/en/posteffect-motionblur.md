# Motion Blur

Motion Blur uses the camera motion-vector buffer to blur fast camera or object motion after the main scene render.

It is useful for racing, fast camera moves, high-speed projectiles, and cinematic transitions. Avoid strong values in UI-heavy scenes or precise inspection tools, because it can reduce readability.

## Enable Motion Blur

```ts
camera.motionBlur = true;
camera.motionBlurStrength = 1;
```

Properties:

| Property | Type | Meaning |
| --- | --- | --- |
| `camera.motionBlur` | `boolean` | Enables or disables the effect |
| `camera.motionBlurStrength` | `number` | Blur intensity multiplier; default is `1` |
| `camera.motionBlurShutterBias` | `number` | How much of the streak lies ahead of where an object is now, as a fraction of its length. 0 trails it fully behind the object; the default `0.5` centres it |
| `camera.motionBlurMaxLength` | `number` | Longest streak, in pixels at render resolution, default `40`. `motionBlurStrength` runs into this ceiling; raising it costs samples in proportion |

## Runnable Example

<div class="showcase" case="tut-73" style="width:600px;height:500px"></div>

