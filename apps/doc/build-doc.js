const crossSpawn = require('cross-spawn');
const path = require('path');

const typedoc = path.join(__dirname, 'node_modules', '.bin', 'typedoc');
const optionsPath = path.join(__dirname, 'typedoc.json');

function spawnSync(cmd, args, cwd) {
  const child = crossSpawn.sync(cmd, args, {
    cwd: cwd ?? process.cwd(),
    env: { ...process.env, NODE_OPTIONS: '--max_old_space_size=8192' },
    stdio: 'inherit'
  });
  if (child.status !== 0) {
    process.exit(child.status);
  }
}

// Generate API reference markdown for all packages with TypeDoc.
// TypeDoc reads the library sources directly (see typedoc.json / tsconfig.typedoc.json),
// emits VitePress-compatible markdown under web/api, and writes web/api/typedoc-sidebar.json
// which .vitepress/config.mts consumes for the API sidebar.
spawnSync(typedoc, ['--options', optionsPath], __dirname);
