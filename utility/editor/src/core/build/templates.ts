export const templateScript = `import type { IDisposable } from '@zephyr3d/base';
import { RuntimeScript } from '@zephyr3d/runtime';
// Change HostType to your attachment type
type HostType = IDisposable;
export default class MyScript extends RuntimeScript<HostType> {
  onCreated(): void | Promise<void> {
  }
  onAttached(_host: HostType): void | Promise<void> {
  }
  onUpdate(_deltaTime: number, _elapsedTime: number) {
  }
  onDetached() {
  }
  onDestroy() {
  }
}
`;

export const templateIndex = `import { Application } from '@zephyr3d/scene';
import { backendWebGL1, backendWebGL2 } from '@zephyr3d/backend-webgl';
import { backendWebGPU } from '@zephyr3d/backend-webgpu';
const deviceType = new URL(window.location.href).searchParams.get('device');
const HelloApp = new Application({
  backend: deviceType === 'webgl' ? backendWebGL1 : deviceType === 'webgl2' ? backendWebGL2 : backendWebGPU,
  canvas: document.querySelector('#canvas'),
  runtimeOptions: {
    scriptsRoot: '/assets'
  }
});
HelloApp.ready().then(async () => {
  await HelloApp.runtimeManager.attachScript(null, '#/index');
  HelloApp.run();
});
`;

export const templateIndexHTML = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>HelloApp</title>
    <style>
      * {
        margin: 0;
        padding: 0;
      }
      html,
      body {
        width: 100vw;
        height: 100vh;
      }
      canvas {
        position: absolute;
        left: 0;
        top: 0;
        width: 100%;
        height: 100%;
      }
    </style>
  </head>
  <!-- 可选：若需兼容不原生支持 Import Maps 的浏览器(如部分 Firefox), 请在本脚本之前引入 es-module-shims,并将入口脚本改为 type="module-shim" -->
  <!-- <script async src="https://unpkg.com/es-module-shims@1/dist/es-module-shims.js"></script> -->
  <!-- 放在 <head> 顶部，确保位于任何 <script type="module"> 或 modulepreload 之前 -->
  <script>
    // 插桩：启动前根据 share-config.json 生成 importmap, 映射到“桩模块” blob: URL
    (function () {
      if (window.__shared_importmap_initialized__) return;
      window.__shared_importmap_initialized__ = true;
      var CONFIG_URL = './share-config.json'; // 配置文件路径（同源）
      function getGlobalVarName(moduleName) {
        return '__shared_module_' + moduleName.replace(/[@\/\-\.]/g, '_') + '__';
      }
      // 生成“桩模块”代码：仅从 window 读取并导出，不依赖真实库已加载
      function buildStubModuleCode(name, exportsList, hasDefault) {
        var g = "window['" + getGlobalVarName(name) + "']";
        var lines = [];
        // 调试需要可打开下一行
        // lines.push("console.debug('[ImportMap Stub] loaded for " + name + "');");
        // 默认导出：统一导出整个命名空间对象（即便没有 default 也导出以便 import ns from ... 使用）
        lines.push("export default " + g + ";");
        if (exportsList && exportsList.length) {
          lines.push("const __m = " + g + ";");
          for (var i = 0; i < exportsList.length; i++) {
            var key = exportsList[i];
            // 注意：如果 __m 还未赋值，这里导出的值为 undefined；业务侧需确保先完成真实库赋值再使用
            lines.push("export const " + key + " = __m && __m['" + key + "'];");
          }
        }
        return lines.join('\n') + '\n';
      }
      function initImportMap() {
        return fetch(CONFIG_URL, { credentials: 'same-origin', cache: 'no-cache' })
          .then(function (res) {
            if (!res.ok) throw new Error('Failed to load ' + CONFIG_URL + ': ' + res.status);
            return res.json();
          })
          .then(function (list) {
            if (!Array.isArray(list)) {
              throw new Error('share-config.json must be an array of { name, exports, hasDefault }');
            }
            var imports = {};
            var revokers = [];
            for (var i = 0; i < list.length; i++) {
              var item = list[i] || {};
              var name = item.name;
              var exportsList = Array.isArray(item.exports) ? item.exports : [];
              var hasDefault = !!item.hasDefault;
              if (typeof name !== 'string' || !name) {
                console.warn('[ImportMap Stub] skip invalid item:', item);
                continue;
              }
              var code = buildStubModuleCode(name, exportsList, hasDefault);
              var blob = new Blob([code], { type: 'application/javascript' });
              var url = URL.createObjectURL(blob);
              imports[name] = url;
              revokers.push(url);
            }
            var s = document.createElement('script');
            s.type = 'importmap';
            s.textContent = JSON.stringify({ imports: imports }, null, 2);
            document.head.appendChild(s);
            window.addEventListener('unload', function () {
              for (var j = 0; j < revokers.length; j++) {
                try { URL.revokeObjectURL(revokers[j]); } catch (e) {}
              }
            });
            window.__shared_importmap_ready__ = true;
          })
          .catch(function (err) {
            console.error('[ImportMap Stub] init failed:', err);
            throw err;
          });
      }
      window.__init_shared_importmap__ = initImportMap();
    })();
  </script>
  <body>
    <canvas id="canvas"></canvas>
  </body>
</html>
`;
