import { defineConfig } from 'vite';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { viteStaticCopy } from 'vite-plugin-static-copy';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageNames = ['base', 'device', 'scene', 'imgui', 'backend-webgl', 'backend-webgpu'];
const runtimeSourcePackageNames = ['base', 'device', 'scene', 'backend-webgl', 'backend-webgpu'];
const sourceAliases = Object.fromEntries(
  runtimeSourcePackageNames.map((name) => [
    `@zephyr3d/${name}`,
    resolve(__dirname, `../../libs/${name}/src/index.ts`)
  ])
);

function toViteFsPath(filePath) {
  return `/@fs/${filePath.replace(/\\/g, '/')}`;
}

const monacoPackages = packageNames.map((name) => ({
  name: `@zephyr3d/${name}`,
  devEntry: toViteFsPath(resolve(__dirname, `../../libs/${name}/src/index.ts`)),
  devRoot: toViteFsPath(resolve(__dirname, `../../libs/${name}/src`)),
  prodDts: `./vendor/zephyr3d/${name}/dist/index.d.ts`,
  useSourceInDev: name !== 'imgui'
}));

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

export default defineConfig(({ command }) => {
  const isDev = command === 'serve';
  return {
    root: '.',
    publicDir: 'public',
    base: './',
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
          moduleSideEffects: (id) => {
            return /[\\\/]zephyr3d[\\\/]libs[\\\/]/.test(id);
          },
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
      open: true,
      fs: {
        allow: [resolve(__dirname, '..', '..')]
      }
    },
    preview: {
      host: 'localhost',
      port: 8000
    },
    plugins: [createStaticCopyPlugin()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
        ...(isDev ? sourceAliases : {})
      },
      extensions: ['.js', '.ts', '.jsx', '.tsx', '.json']
    },
    define: {
      __DEV__: JSON.stringify(process.env.NODE_ENV === 'development'),
      __ZEPHYR3D_MONACO_PACKAGES__: JSON.stringify(monacoPackages)
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
