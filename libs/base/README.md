# @zephyr3d/base

Zephyr3d is a set of API for 3D rendering within the browser. 

Zephyr3d is released as ES6 modules and requires npm for installation. It is designed to be used in conjunction with front-end build tools such as Webpack or Vite for development.

## Installation

- @zephyr3d/base

  The basic module includes a math library and content commonly used in other modules.

  ```npm install --save @zephyr3d/base```

- @zephyr3d/device

  Includes the basic definitions and abstract interfaces of the rendering API.

  ```npm install --save @zephyr3d/device```

- @zephyr3d/backend-webgl

  WebGL backend, WebGL/WebGL2 rendering.

  ```npm install --save @zephyr3d/backend-webgl```

- @zephyr3d/backend-webgpu

  WebGPU backend.

  ```npm install --save @zephyr3d/backend-webgpu```

- @zephyr3d/scene

  The SceneAPI module, built on top of the DeviceAPI module, facilitates rapid development of rendering projects.
  
  ```npm install --save @zephyr3d/scene```

- @zephyr3d/imgui

  To render a GUI, you can install the ImGui binding module.

  ```npm install --save @zephyr3d/imgui```



