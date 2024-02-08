<!-- Do not edit this file. It is automatically generated by API Documenter. -->

[Home](doc/markdown/./index.md) &gt; [@zephyr3d/scene](doc/markdown/./scene.md) &gt; [Application](doc/markdown/./scene.application.md)

## Application class

Application class

**Signature:**

```typescript
declare class Application extends Application_base 
```
**Extends:** Application\_base

## Remarks

This is the entry point of your application. The Application is responsible for initializing the rendering device and doing the rendering loop. The Application can not be created more than once. You can get the instance by calling the 'Application.instance' static method.

## Constructors

|  Constructor | Modifiers | Description |
|  --- | --- | --- |
|  [(constructor)(opt)](doc/markdown/./scene.application._constructor_.md) |  | Creates an instance of Application |

## Properties

|  Property | Modifiers | Type | Description |
|  --- | --- | --- | --- |
|  [canRender](doc/markdown/./scene.application.canrender.md) | <code>readonly</code> | boolean | Query if the device is ok to render objects now. |
|  [device](doc/markdown/./scene.application.device.md) | <code>readonly</code> | [AbstractDevice](doc/markdown/./device.abstractdevice.md) | The rendering device that was initialized by the application |
|  [deviceType](doc/markdown/./scene.application.devicetype.md) | <code>readonly</code> | string | Gets the device type |
|  [inputManager](doc/markdown/./scene.application.inputmanager.md) | <code>readonly</code> | InputManager | The input manager instance |
|  [instance](doc/markdown/./scene.application.instance.md) | <p><code>static</code></p><p><code>readonly</code></p> | [Application](doc/markdown/./scene.application.md) | Gets the singleton instance of the application |
|  [logger](doc/markdown/./scene.application.logger.md) |  | [Logger](doc/markdown/./scene.logger.md) | The logger object |
|  [options](doc/markdown/./scene.application.options.md) | <code>readonly</code> | [AppOptions](doc/markdown/./scene.appoptions.md) | The options that was used to create the application |
|  [timeElapsedInSeconds](doc/markdown/./scene.application.timeelapsedinseconds.md) | <code>readonly</code> | number | Query time elapsed since last frame in seconds |

## Methods

|  Method | Modifiers | Description |
|  --- | --- | --- |
|  [focus()](doc/markdown/./scene.application.focus.md) |  | Set focus |
|  [frame()](doc/markdown/./scene.application.frame.md) |  | Render one frame |
|  [log(text, mode)](doc/markdown/./scene.application.log.md) |  | Message log |
|  [ready()](doc/markdown/./scene.application.ready.md) |  | Wait until the application is ready. |
|  [run()](doc/markdown/./scene.application.run.md) |  | Start running the rendering loop |
|  [stop()](doc/markdown/./scene.application.stop.md) |  | Stop running the rendering loop |
