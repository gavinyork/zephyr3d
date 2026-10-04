import { nodeResolve } from '@rollup/plugin-node-resolve';
import { swc } from 'rollup-plugin-swc3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import copy from 'rollup-plugin-copy';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const srcdir = path.join(__dirname, 'src');
const destdir = path.join(__dirname, 'dist');

// The demo model, from a local copy of KhronosGroup/glTF-Sample-Models when there is one
// (GLTF_SAMPLE_MODELS points at its 2.0 directory); the page falls back to the CDN otherwise
const sampleModels = process.env.GLTF_SAMPLE_MODELS ?? 'D:/works/glTF-Sample-Models/2.0';
const helmet = path.join(sampleModels, 'DamagedHelmet/glTF-Binary/DamagedHelmet.glb');

export default () => ({
  input: path.join(srcdir, 'main.ts'),
  preserveSymlinks: false,
  output: {
    file: path.join(destdir, 'js', `main.js`),
    format: 'esm',
    sourcemap: true
  },
  onwarn(warning) {
    if (warning.code === 'CIRCULAR_DEPENDENCY') {
      console.error(warning.message);
    }
  },
  plugins: [
    nodeResolve(),
    swc({
      sourceMaps: true,
      inlineSourcesContent: false
    }),
    copy({
      targets: [
        { src: ['index.html'], dest: destdir },
        // Globs take forward slashes, also on Windows
        ...(fs.existsSync(helmet)
          ? [{ src: [helmet.split(path.sep).join('/')], dest: path.join(destdir, 'assets') }]
          : [])
      ],
      verbose: true
    })
  ]
});
