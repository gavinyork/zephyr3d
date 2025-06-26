// debug-rollup.js
import { rollup } from 'rollup';
import config from './rollup.config.mjs';

async function debugBuild() {
  try {
    console.log('🚀 开始调试构建...');

    // 如果配置是数组，逐个处理
    const configs = config();

    for (const cfg of configs) {
      console.log(`📦 处理配置: ${cfg.input}`);

      const bundle = await rollup(cfg);

      if (Array.isArray(cfg.output)) {
        for (const output of cfg.output) {
          await bundle.write(output);
        }
      } else {
        await bundle.write(cfg.output);
      }

      await bundle.close();
    }

    console.log('✅ 构建完成');
  } catch (error) {
    console.error('❌ 构建失败:', error);
    process.exit(1);
  }
}

debugBuild();
