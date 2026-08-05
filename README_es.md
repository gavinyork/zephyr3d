<!-- hy-mt2-i18n:start -->
[English](./README.md) | [中文](./README_zh-CN.md) | [日本語](./README_ja.md) | **Español**
<!-- hy-mt2-i18n:end -->



<div align="center">

  ![](https://cdn.zephyr3d.org/doc/assets/images/logo_theme.svg)

> Un motor de renderizado WebGL y WebGPU moderno basado en TypeScript

[Manual de usuario](https://zephyr3d.org/doc/) &nbsp;|&nbsp; [Demonstraciones](https://zephyr3d.org/en/demos.html) &nbsp;|&nbsp; [Editor en línea](https://zephyr3d.org/editor/)

[![CI](https://github.com/gavinyork/zephyr3d/actions/workflows/ci.yml/badge.svg)](https://github.com/gavinyork/zephyr3d/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@zephyr3d/scene?color=%235865f2)](https://www.npmjs.com/package/@zephyr3d/scene)
[![Licencia: MIT](https://img.shields.io/badge/license-MIT-blueviolet.svg)](https://opensource.org/licenses/MIT)

</div>

## Resumen general

**Zephyr3D** es un motor de renderizado 3D para la web basado en TypeScript, que cuenta con

 - backends unificados para WebGL y WebGPU
 - un sistema de shaders generado por código (JS/TS → GLSL/WGSL)
 - y un editor visual completamente basado en la web.  

> Ligero · Modular · Amigable para desarrolladores · Creación visual potenciada por el código.

## Visión general

**Zephyr3D** es un motor de renderizado 3D para la web basado en TypeScript, que cuenta con

 - Backends unificados para WebGL y WebGPU  
- Un sistema de shaders generado por código (JS/TS → GLSL/WGSL)  
- Y un editor visual completo basado en la web.

Ligero · Modular · Amigable para desarrolladores · Creación visual potenciada por código.

# Características principales

## Características principales

- **Backend unificado WebGL/WebGPU (RHI)**  
  Una sola capa de abstracción de renderizado, múltiples backends. Pase de WebGL, WebGL2 a WebGPU sin tener que reescribir su código de escena.

- **Generador de shaders basado en JS/TS**  
  Crea shaders en TypeScript/JavaScript y genera, a partir de una sola fuente, código GLSL/WGSL específico para cada backend, además de diseños de grupos de enlace para WebGPU.

- **Renderizado moderno de escenas**  
  PBR, iluminación basada en imágenes, iluminación agrupada, mapas de sombras, terrenos, agua basada en FFT, procesamiento posterior y mucho más.

- **Arquitectura centrada en TypeScript**  
  Tipado estricto, paquetes modulares y API amigables para IDEs, ideales para el desarrollo de motores y herramientas.

- **Editor visual basado en la web**  
  Editores de escenas, materiales y terrenos, además de scripting en TypeScript: todo funciona directamente en el navegador.

- **Paquetes modulares listos para NPM**  
  Utilice solo las partes que necesite: matemáticas básicas, dispositivos/RHI, backends, capa de escena, o el editor completo.

## Generador de shaders basado en JS/TS

En lugar de escribir manualmente cadenas en GLSL/WGSL sin formato, Zephyr3D le permite **definir shaders en JavaScript/TypeScript** y genera para usted el código específico del backend.

Un único programa en JS:

```ts  
const program = device.buildRenderProgram({  
  vertex(pb) {  
    this.$inputs.pos = pb.vec3().attrib('position');  
    this.$inputs.uv  = pb.vec2().attrib('texCoord0');  
    this.$outputs.uv = pb.vec2();  

    this.xform = pb.defineStruct([pb.mat4('mvpMatrix')])().uniform(0);  

    pb.main(function () {  
      this.$builtins.position =  
        pb.mul(this.xform.mvpMatrix, pb.vec4(this.$inputs.pos, 1));  
      this.$outputs.uv = this.$inputs.uv;  
    });  
  },  

  fragment(pb) {  
    this.$outputs.color = pb.vec4();  
    this.tex = pb.tex2D().uniform(0);  

    pb.main(function () {  
      this.$outputs.color = pb.textureSample(this.tex, this.$inputs.uv);  
    });  
  }  
});  
```

A partir de esta única fuente, Zephyr3D genera:

- GLSL para WebGL 1 (atributos/variaciones, uniformes clásicos)  
- GLSL para WebGL 2 (UBOs con layout(std140), salidas explícitas)  
- Shaders WGSL para WebGPU  
- Layouts de grupos de enlaces compatibles en WebGPU (texturas, muestreadores, buffers de uniformes con layouts calculados)

Por lo tanto, usted:

- Escribir la lógica del shader una sola vez en JS/TS  
- Obtener el GLSL/WGSL adecuado para cada plataforma  
- Mantener automáticamente sincronizados los enlaces y el código del shader  
- Evitar tener que gestionar N variantes ligeramente diferentes del shader

Para ejemplos más avanzados, consulte el [Manual del usuario](https://zephyr3d.org/doc/).

# Restricciones estrictas
1. **Bloqueo estructural**: Mantener absolutamente intacta la estructura de datos Markdown original, los sangrados, los niveles de título, las tablas, los enlaces, las URL, las insignias, los bloques de código y el código dentro de las líneas.
2. **Traducción selectiva**: Solo traducir el contenido de lenguaje natural visible para el usuario.
3. **Prohibición de modificaciones**: Está **estrictamente prohibido** traducir o cambiar etiquetas de código, nombres de claves, placeholders de variables (como {{var}}, ${var}, %s, %d, etc.), ejemplos de comandos, rutas de archivos, nombres de proyectos, nombres de API, nombres de paquetes, nombres de modelos, identificadores y símbolos de código; a menos que la información de contexto ya proporcione su traducción correspondiente.
4. Las traducciones de términos, estilos y nombres propios deben ser consistentes con la información de contexto proporcionada.

## Editor de Zephyr3D: *Herramienta visual basada en la web*

<div align="center">

**Pruébelo en línea → [Zephyr3D Editor](https://zephyr3D.org/editor/)**  
*(No se requiere instalación: funciona completamente en el navegador)*

<br/>

<img src="https://cdn.zephyr3d.org/doc/assets/images/editor-sm.jpg" width="80%" alt="Editor web de Zephyr3D">

</div>

**Características destacadas**  
- Editores de escena, materiales y terrenos  
- Herramientas de scripting en TypeScript y animación  
- Desarrollado con las APIs de escena y dispositivos de Zephyr3D  
- Vista previa instantánea y exportación con un solo clic

## Editor de escritorio de Zephyr3D

El editor de escritorio está disponible como versión Electron para proyectos locales y almacenamiento persistente. Agrega soporte de IA a través de MCP y el asistente LLM integrado, y las claves API se almacenan localmente y se cifran en reposo.

Descargue la última versión para escritorio: [GitHub Releases](https://github.com/gavinyork/zephyr3d/releases)

## Visión general de la arquitectura

## Visión general de la arquitectura

| Capa | Descripción |
|-------|--------------|
| **Base** | Matemáticas / VFS / Eventos / SmartPtr |
| **Device (RHI)** | Capa de API gráfica abstracta + generador de shaders / enlace de recursos |
| **Backend-WebGL / WebGPU** | Backends de renderizado específicos de la plataforma |
| **Scene** | Sistema de escena, materiales, animación, efectos posteriores |
| **Editor** | Editor nativo del navegador desarrollado sobre la capa Scene |

# Convención de profundidad (inversa-Z)

## Instalación

```bash
npm install --save @zephyr3d/device
npm install --save @zephyr3d/backend-webgl
npm install --save @zephyr3d/backend-webgpu
npm install --save @zephyr3d/scene
```

Úselo con su bundler preferido (Vite / Webpack / Rollup).

---

## Convención de profundidad (Reverse-Z)

El motor admite dos convenciones de profundidad, que se seleccionan una sola vez al cargarlo:

- **Standard-Z**: la profundidad del dispositivo es 0 en el plano cercano y 1 en el plano lejano.  
- **Reverse-Z** (valor predeterminado): la profundidad del dispositivo es 1 en el plano cercano y 0 en el plano lejano. Con un buffer de profundidad de punto flotante (`d32f` / `d32fs8`, el valor predeterminado en WebGPU y WebGL2), esto genera una distribución de errores de profundidad casi uniforme y reduce en gran medida los problemas de conflicto de profundidad a grandes distancias.

Habilite el modo Reverse-Z mediante una definición en tiempo de compilación para que su bundler pueda eliminar la ruta de código no utilizada: path:

```js
// vite.config.js / esbuild
define: { __ZEPHYR3D_REVERSE_Z__: 'true' }

// rollup (@rollup/plugin-replace)
replace({ preventAssignment: true, values: { __ZEPHYR3D_REVERSE_Z__: 'true' } })
```

Si no se utiliza un bundler, establezca la variable global **antes de la primera importación de cualquier módulo `@zephyr3d/*`**:

```html
<script>globalThis.__ZEPHYR3D_REVERSE_Z__ = true;</script>
<script type="module" src="app.js"></script>
```

La convención queda fija durante toda la vida útil de la página. Notas del backend:

- **WebGPU**: se aprovechan todos los beneficios sin requisitos adicionales.  
- **WebGL/WebGL2**: el motor activa `EXT_clip_control` cuando está disponible (Chromium 121+); sin él, una solución alternativa en el shader mantiene la renderización correcta, pero el beneficio de precisión es limitado. WebGL1 no cuenta con formato de profundidad en flotante, por lo que el modo reverse-Z sí funciona, pero no ofrece mejora en precisión.  
- Los materiales personalizados deben utilizar las constantes exportadas (`REVERSE_Z`, `DEPTH_CLEAR_VALUE`, `DEPTH_COMPARE_DEFAULT`, `DEPTH_FARTHEST`,...) de `@zephyr3d/base` y las herramientas de profundidad de `ShaderHelper`, en lugar de codificar manualmente valores de profundidad o direcciones de comparación.  
- Limitación conocida: las proyecciones con recorte oblicuo (`Matrix4x4.obliqueProjection/obliquePerspective`, utilizadas para reflejos en superficies planas) aún no son compatibles con reverse-Z y generan un error explícito.

# Restricciones estrictas
1. **Bloqueo de estructura**: Se debe mantener intacta por completo la estructura de datos Markdown original, los sangrados, los niveles de título, las tablas, los enlaces, las URL, las insignias, los bloques de código y el código inline.
2. **Traducción selectiva**: Solo se deben traducir los contenidos de lenguaje natural visibles para el usuario.
3. **Prohibición de modificaciones**: Está **estrictamente prohibido** traducir o cambiar etiquetas de código, nombres de claves, placeholders de variables (como {{var}}, ${var}, %s, %d, etc.), ejemplos de comandos, rutas de archivos, nombres de proyectos, nombres de API, nombres de paquetes, nombres de modelos, identificadores y símbolos de código; a menos que ya exista una traducción correspondiente en la información de contexto.
4. Las traducciones de términos, estilos y nombres propios deben ser consistentes con la información de contexto proporcionada.

## Ejemplo: API de escena

```ts
import { Vector3, Vector4 } from '@zephyr3d/base';
import {
  Scene, Application, LambertMaterial, Mesh,
  OrbitCameraController, PerspectiveCamera,
  SphereShape, DirectionalLight
} from '@zephyr3d/scene';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';

const app = new Application({
  backend: backendWebGL2,
  canvas: document.querySelector('#my-canvas')
});

app.ready().then(() => {
  const scene = new Scene();
  new DirectionalLight(scene).lookAt(Vector3.one(), Vector3.zero(), Vector3.axisPY());
  const mat = new LambertMaterial();
  mat.albedoColor = new Vector4(0.9, 0.1, 0.1, 1);
  new Mesh(scene, new SphereShape(), mat);
  scene.mainCamera = new PerspectiveCamera(scene, Math.PI / 3, 1, 100);
  scene.mainCamera.lookAt(new Vector3(0,0,4), Vector3.zero(), Vector3.axisPY());
  scene.mainCamera.controller = new OrbitCameraController({ center: Vector3.zero() });
  getInput().use(scene.mainCamera.handleEvent, scene.mainCamera);
  getEngine().setRenderable(scene, 0);
  app.run();
});
```

## Estado

**En desarrollo activo**  

Zephyr3D se utiliza para mis propios experimentos, demostraciones y herramientas, y se encuentra en proceso de desarrollo activo.  
Las APIs pueden seguir cambiando, pero ya es adecuado para:  

- experimentos de gráficos y renderizado web  
- aprender sobre arquitecturas de motor y renderizado  
- crear herramientas personalizadas y editores internos

## Estado

En desarrollo activo

Zephyr3D se utiliza en mis propios experimentos, demostraciones y herramientas, y se encuentra en desarrollo activo.  
Las API aún pueden cambiar, pero ya es adecuado para:

- Experimentos con gráficos y renderizado en la web  
- Motor de aprendizaje y arquitectura de renderizado  
- Creación de herramientas personalizadas y editores internos

# Restricciones estrictas
1. **Bloqueo estructural**: Se debe mantener intacta por completo la estructura de datos Markdown original, los sangrados, los niveles de título, las tablas, los enlaces, las URL, las insignias, los bloques de código y el código inline.
2. **Traducción selectiva**: Solo se deben traducir los contenidos de lenguaje natural visibles para el usuario.
3. **Prohibición de modificaciones**: Está **estrictamente prohibido** traducir o modificar etiquetas de código, nombres de claves, placeholders de variables (como {{var}}, ${var}, %s, %d, etc.), ejemplos de comandos, rutas de archivos, nombres de proyectos, nombres de API, nombres de paquetes, nombres de modelos, identificadores y símbolos de código; a menos que ya exista una traducción correspondiente en la información de contexto.
4. La traducción de términos, estilos y nombres propios debe ser coherente con la información de contexto proporcionada.

## Soporte

Zephyr3D se desarrolla y mantiene en mi tiempo libre.  
Si este motor, el editor o cualquier herramienta o publicación relacionada le ha sido de ayuda, puede apoyar mi trabajo aquí:

Ko‑fi: https://ko-fi.com/gavinyork2024

Su apoyo ayuda a cubrir los costos de alojamiento y las herramientas de pruebas, y me brinda más tiempo para concentrarme en:

- Desarrollar nuevas funcionalidades para el motor y mejorar su rendimiento  
- Mantener la documentación y los ejemplos  
- Explorar ideas experimentales de renderizado y herramientas relacionadas

Gracias por cualquier tipo de apoyo; incluso el simple hecho de probar Zephyr3D y compartir sus comentarios es de gran valor para nosotros.

---

## Licencia

Zephyr3D se distribuye bajo la [Licencia MIT](https://opensource.org/licenses/MIT).

---

<div align="center">

**© 2025 Zephyr3D — Desarrollado con 💙 en TypeScript para el mundo de Web3D.**

</div>
