import { nodeResolve } from '@rollup/plugin-node-resolve';
import { swc } from 'rollup-plugin-swc3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const srcdir = path.join(__dirname, 'src');
const destdir = path.join(__dirname, 'dist');

function collectTestFiles(dir, baseDir, out = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectTestFiles(fullPath, baseDir, out);
    } else if (entry.isFile() && entry.name.endsWith('.test.ts')) {
      const rel = path.relative(baseDir, fullPath); // e.g. "foo/bar.test.ts"
      out.push({ fullPath, relPath: rel });
    }
  }
  return out;
}

const testFiles = collectTestFiles(srcdir, srcdir);
if (testFiles.length === 0) {
  console.log('No .test.ts files found under src/');
} else {
  console.log('Test files found:');
  for (const f of testFiles) {
    console.log('  ' + f.fullPath);
  }
}

function getTargetESM(input, relPath) {
  // relPath: e.g. "foo/bar.test.ts" -> output: "foo/bar.test.js"
  const outRel = relPath.replace(/\.ts$/, '.js');
  const outFile = path.join(destdir, outRel);

  return {
    input,
    preserveSymlinks: false,
    output: {
      file: outFile,
      format: 'esm',
      sourcemap: true
    },
    onwarn(warning, warn) {
      if (warning.code === 'CIRCULAR_DEPENDENCY') {
        console.error(warning.message);
      } else {
        warn(warning);
      }
    },
    plugins: [
      nodeResolve(),
      swc({
        sourceMaps: true,
        inlineSourcesContent: false
      })
    ]
  };
}

export default () => {
  const targets = testFiles.map((f) => getTargetESM(f.fullPath, f.relPath));
  return targets;
};
