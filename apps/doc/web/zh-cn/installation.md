# 安装

Zephyr3d以ES6模块的形式发布，需要使用npm来安装，配合Webpack或vite等前端构建工具进行开发。

- @zephyr3d/base模块

  基础模块，包括数学库以及部分其他模块公用的内容。

  ```npm install --save @zephyr3d/base```

- @zephyr3d/device模块

  包含了渲染底层API的基本定义和抽象接口。

  ```npm install --save @zephyr3d/device```

- @zephyr3d/backend-webgl

  WebGL渲染设备后端，支持WebGL/WebGL2渲染。

  ```npm install --save @zephyr3d/backend-webgl```

- @zephyr3d/backend-webgpu

  WebGPU渲染设备后端。

  ```npm install --save @zephyr3d/backend-webgpu```

- @zephyr3d/scene

  SceneAPI模块，基于DeviceAPI模块实现，支持快速开发渲染项目。
  
  ```npm install --save @zephyr3d/scene```

- @zephyr3d/imgui

  ImGui的绑定，如需在项目中渲染GUI，可安装此模块。

  ```npm install --save @zephyr3d/imgui```

