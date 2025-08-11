import { defineConfig } from 'vite';
import { resolve } from 'path';
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig({
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
      treeshake: {
        moduleSideEffects: (id, external) => {
          return /[\\\/]zephyr3d[\\\/]libs[\\\/]/.test(id);
        },
        propertyReadSideEffects: true,
        unknownGlobalSideEffects: true
      }
    },
    sourcemap: true,
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: false, // 保留 console
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
      allow: ['..']
    }
  },
  preview: {
    host: 'localhost',
    port: 8000
  },
  plugins: [
    viteStaticCopy({
      targets: [
        {
          src: 'node_modules/monaco-editor/dev/vs',
          dest: 'vendor/monaco'
        }
      ]
    })
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    },
    extensions: ['.js', '.ts', '.jsx', '.tsx', '.json']
  },
  define: {
    __DEV__: JSON.stringify(process.env.NODE_ENV === 'development')
  },
  css: {
    preprocessorOptions: {
      scss: {}
    },
    modules: {
      generateScopedName: '[name]__[local]___[hash:base64:5]'
    }
  }
});
