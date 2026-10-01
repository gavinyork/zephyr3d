import fs from 'fs';
import { dirname, extname, resolve, sep } from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '..', '..');
const sourceRoutePrefix = '/__zephyr_source__';
const packageJson = JSON.parse(fs.readFileSync(resolve(__dirname, 'package.json'), 'utf8'));
const packageNames = ['base', 'device', 'scene', 'loaders', 'imgui', 'backend-webgl', 'backend-webgpu'];
const runtimeSourcePackageNames = ['base', 'device', 'scene', 'loaders', 'backend-webgl', 'backend-webgpu'];
const sourceAliases = Object.fromEntries(
  runtimeSourcePackageNames.map((name) => [
    `@zephyr3d/${name}`,
    resolve(__dirname, `../../libs/${name}/src/index.ts`)
  ])
);
const monacoSourceRoots = {
  base: resolve(__dirname, '../../libs/base/src'),
  device: resolve(__dirname, '../../libs/device/src'),
  scene: resolve(__dirname, '../../libs/scene/src'),
  loaders: resolve(__dirname, '../../libs/loaders/src'),
  imgui: resolve(__dirname, '../../libs/imgui/src'),
  'backend-webgl': resolve(__dirname, '../../libs/backend-webgl/src'),
  'backend-webgpu': resolve(__dirname, '../../libs/backend-webgpu/src'),
  'editor-plugin': resolve(__dirname, './src')
};

function collectMonacoSourceFiles(rootDir, key, currentDir = rootDir) {
  const entries = fs.readdirSync(currentDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = resolve(currentDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectMonacoSourceFiles(rootDir, key, fullPath));
      continue;
    }
    const relativePath = fullPath
      .slice(rootDir.length)
      .replace(/^[\\/]+/, '')
      .replace(/\\/g, '/');
    files.push(`${sourceRoutePrefix}/${key}/${relativePath}`);
  }
  return files;
}

const monacoSourceFiles = Object.entries(monacoSourceRoots).flatMap(([key, rootDir]) =>
  collectMonacoSourceFiles(rootDir, key)
);

function toViteFsPath(filePath) {
  return `/@fs/${filePath.replace(/\\/g, '/')}`;
}

function toMonacoSourcePath(key, relativePath = '') {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  return normalized ? `${sourceRoutePrefix}/${key}/${normalized}` : `${sourceRoutePrefix}/${key}/`;
}

function createStaticCopyPlugin() {
  return viteStaticCopy({
    targets: [
      {
        src: 'node_modules/monaco-editor/dev/vs',
        dest: 'vendor/monaco'
      },
      ...packageNames.map((name) => ({
        src: `node_modules/@zephyr3d/${name}/dist`,
        dest: `vendor/zephyr3d/${name}`
      }))
    ],
    flatten: false
  });
}

function createImportMapPlugin(isDev) {
  const imports = Object.fromEntries(
    packageNames.map((name) => [
      `@zephyr3d/${name}`,
      isDev
        ? runtimeSourcePackageNames.includes(name)
          ? toViteFsPath(resolve(__dirname, `../../libs/${name}/src/index.ts`))
          : toViteFsPath(resolve(__dirname, `../../libs/${name}/dist/index.js`))
        : `./modules/zephyr3d_${name}.js`
    ])
  );

  return {
    name: 'zephyr3d-importmap',
    transformIndexHtml(html) {
      return html.replace('__ZEPHYR3D_IMPORT_MAP__', JSON.stringify({ imports }, null, 2));
    }
  };
}

function createMonacoSourcePlugin(isDev) {
  if (!isDev) {
    return null;
  }

  const editorDistRoot = resolve(__dirname, 'dist');

  return {
    name: 'zephyr3d-monaco-source',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const requestUrl = req.url ? new URL(req.url, 'http://127.0.0.1') : null;
        if (!requestUrl) {
          next();
          return;
        }

        if (requestUrl.pathname.startsWith('/modules/')) {
          const target = resolve(editorDistRoot, `.${requestUrl.pathname}`);
          if (
            (target === editorDistRoot || target.startsWith(`${editorDistRoot}${sep}`)) &&
            fs.existsSync(target) &&
            fs.statSync(target).isFile()
          ) {
            // Binary as well as script: the runtime decoders (basis/, draco/) live here too
            const types = {
              '.js': 'application/javascript; charset=utf-8',
              '.wasm': 'application/wasm',
              '.map': 'application/json'
            };
            res.statusCode = 200;
            res.setHeader('Content-Type', types[extname(target).toLowerCase()] ?? 'application/octet-stream');
            res.end(fs.readFileSync(target));
            return;
          }
          next();
          return;
        }

        if (!requestUrl.pathname.startsWith(`${sourceRoutePrefix}/`)) {
          next();
          return;
        }

        const [key, ...segments] = requestUrl.pathname.slice(sourceRoutePrefix.length + 1).split('/');
        const root = monacoSourceRoots[key];
        if (!root) {
          res.statusCode = 404;
          res.end('Not Found');
          return;
        }

        const target = resolve(root, ...segments.filter(Boolean));
        const resolvedRoot = resolve(root);
        if (target !== resolvedRoot && !target.startsWith(`${resolvedRoot}${sep}`)) {
          res.statusCode = 403;
          res.end('Forbidden');
          return;
        }

        if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
          res.statusCode = 404;
          res.end('Not Found');
          return;
        }

        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end(fs.readFileSync(target, 'utf8'));
      });
    }
  };
}

const monacoPackages = [
  ...packageNames.map((name) => ({
    name: `@zephyr3d/${name}`,
    devEntry: toMonacoSourcePath(name, 'index.ts'),
    devRoot: toMonacoSourcePath(name),
    prodDts: `./vendor/zephyr3d/${name}/dist/index.d.ts`,
    useSourceInDev: name !== 'imgui'
  })),
  {
    name: '@zephyr3d/editor/editor-plugin',
    devEntry: toMonacoSourcePath('editor-plugin', 'core/pluginapi.ts'),
    devRoot: toMonacoSourcePath('editor-plugin'),
    prodDts: './vendor/zephyr3d/editor/dist/pluginapi/core/pluginapi.d.ts',
    useSourceInDev: true,
    virtualEntryPath: 'file:///node_modules/@zephyr3d/editor/editor-plugin/index.d.ts'
  }
];

export default defineConfig(({ command }) => {
  const isDev = command === 'serve';
  const plugins = [
    createMonacoSourcePlugin(isDev),
    createImportMapPlugin(isDev),
    createStaticCopyPlugin()
  ].filter(Boolean);

  return {
    root: '.',
    publicDir: 'public',
    base: './',
    optimizeDeps: {
      // Locates its WebAssembly with new URL('bindings_wasm_bg.wasm', import.meta.url).
      // Pre-bundling moves the module into node_modules/.vite/deps without the .wasm,
      // and the dev server answers the miss with index.html.
      exclude: ['@rollup/browser']
    },
    build: {
      outDir: 'dist',
      assetsDir: 'assets',
      copyPublicDir: true,
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'index.html')
        },
        external: isDev ? undefined : (id) => id.startsWith('@zephyr3d/'),
        treeshake: {
          moduleSideEffects: (id) => /[\\\/]zephyr3d[\\\/]libs[\\\/]/.test(id),
          propertyReadSideEffects: true,
          unknownGlobalSideEffects: true
        },
        output: {
          entryFileNames: 'assets/index-[hash].js',
          chunkFileNames: 'assets/chunk-[hash].js',
          assetFileNames: 'assets/[name]-[hash][extname]'
        }
      },
      sourcemap: false,
      minify: false,
      terserOptions: {
        compress: {
          drop_console: false,
          drop_debugger: true
        }
      },
      chunkSizeWarningLimit: 1000
    },
    server: {
      host: 'localhost',
      port: 8000,
      open: false,
      fs: {
        allow: [repoRoot]
      }
    },
    preview: {
      host: 'localhost',
      port: 8000
    },
    plugins,
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
        ...(isDev ? sourceAliases : {})
      },
      extensions: ['.js', '.ts', '.jsx', '.tsx', '.json']
    },
    define: {
      __DEV__: JSON.stringify(isDev),
      __EDITOR_VERSION__: JSON.stringify(packageJson.version),
      __ZEPHYR3D_MONACO_PACKAGES__: JSON.stringify(monacoPackages),
      __ZEPHYR3D_MONACO_SOURCE_FILES__: JSON.stringify(monacoSourceFiles)
    },
    css: {
      preprocessorOptions: {
        scss: {}
      },
      modules: {
        generateScopedName: '[name]__[local]___[hash:base64:5]'
      }
    }
  };
});
