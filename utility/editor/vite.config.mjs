import { defineConfig } from 'vite';
import { resolve } from 'path';
import monacoEditorEsmPlugin from 'vite-plugin-monaco-editor-esm';

export default defineConfig({
  root: '.', // 项目根目录

  // 入口文件配置
  build: {
    // 输出目录，对应你原来的 destdir
    outDir: 'dist',

    // 静态资源目录
    assetsDir: 'assets',

    // 入口文件
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html')
        // 如果有多个入口点，可以在这里添加
      },
      output: {
        // 静态资源文件命名
        assetFileNames: 'assets/[name]-[hash][extname]',
        // chunk 文件命名
        chunkFileNames: 'chunks/[name]-[hash].js',
        // 入口文件命名
        entryFileNames: '[name]-[hash].js',

        // 手动 chunk 分割（类似你的 manualChunks）
        manualChunks: (id) => {
          if (id.includes('monaco-editor')) {
            if (id.includes('editor.all') || id.includes('editor.api')) {
              return 'monaco-core';
            }
            if (id.includes('/language/')) {
              return 'monaco-languages';
            }
            if (id.includes('standalone')) {
              return 'monaco-standalone';
            }
            return 'monaco-misc';
          }

          // 对应你的 zephyr3d 配置
          if (id.includes('zephyr3d')) {
            return 'zephyr3d';
          }

          if (id.includes('node_modules')) {
            return 'vendor';
          }
        }
      },

      // 对应你的 treeshake 配置
      treeshake: {
        moduleSideEffects: (id, external) => {
          return /[\\\/]zephyr3d[\\\/]libs[\\\/]/.test(id) || id.includes('monaco-editor');
        },
        propertyReadSideEffects: true,
        unknownGlobalSideEffects: true
      }
    },

    // 源码映射
    sourcemap: true,

    // 压缩配置
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: false, // 保留 console
        drop_debugger: true
      }
    },

    // Chunk 大小警告限制
    chunkSizeWarningLimit: 1000
  },

  // 开发服务器配置
  server: {
    host: 'localhost',
    port: 8000,
    open: true,
    fs: {
      allow: ['..']
    },
    // 如果需要代理 API
    proxy: {
      // '/api': 'http://localhost:3000'
    }
  },

  // 预览服务器配置（npm run preview）
  preview: {
    host: 'localhost',
    port: 8000
  },

  // 插件配置
  plugins: [
    // Monaco Editor 支持
    monacoEditorEsmPlugin({
      // 指定需要的语言
      languageWorkers: ['typescript', 'json', 'html', 'css'],
      // 自定义 worker 路径
      customWorkers: [
        {
          label: 'typescript',
          entry: 'monaco-editor/esm/vs/language/typescript/ts.worker.js'
        }
      ]
    })
  ],

  // 解析配置
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
      // 如果需要其他别名
    },

    // 扩展名
    extensions: ['.js', '.ts', '.jsx', '.tsx', '.json']
  },

  // 环境变量配置
  define: {
    __DEV__: JSON.stringify(process.env.NODE_ENV === 'development')
    // 其他全局变量
  },

  // CSS 配置
  css: {
    // CSS 预处理器选项
    preprocessorOptions: {
      scss: {
        // additionalData: '@import "@/styles/variables.scss";'
      }
    },

    // CSS 模块化
    modules: {
      // 类名生成模式
      generateScopedName: '[name]__[local]___[hash:base64:5]'
    }
  },

  // 优化配置
  optimizeDeps: {
    // 预构建包含的依赖
    include: ['monaco-editor/esm/vs/editor/editor.api', 'monaco-editor/esm/vs/editor/editor.main'],

    // 排除预构建的依赖
    exclude: [
      // 如果有需要排除的
    ]
  },

  // 实验性功能
  experimental: {
    // renderBuiltUrl: (filename, { hostType }) => {
    //   if (hostType === 'js') {
    //     return `https://cdn.example.com/${filename}`
    //   }
    // }
  }
});
