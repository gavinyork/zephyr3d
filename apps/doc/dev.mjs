import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const childProcesses = [];
let stopping = false;

function stopAll(code) {
  if (stopping) {
    return;
  }
  stopping = true;
  for (const child of childProcesses) {
    child.kill('SIGTERM');
  }
  process.exitCode = code;
}

const commands = [
  {
    name: 'VitePress',
    args: [
      path.join(__dirname, 'node_modules', 'vitepress', 'bin', 'vitepress.js'),
      'dev',
      'web',
      '--host',
      '0.0.0.0'
    ],
    env: { DOC_BASE: '/doc/' }
  },
  {
    name: 'tutorials',
    args: [path.join(__dirname, 'watch-tutorials.mjs')],
    env: {}
  },
  {
    name: 'showcase',
    args: [
      path.join(__dirname, 'node_modules', 'rollup', 'dist', 'bin', 'rollup'),
      '-c',
      'rollup.config.showcase.mjs',
      '--watch'
    ],
    env: {}
  }
];

for (const command of commands) {
  const child = spawn(process.execPath, command.args, {
    cwd: __dirname,
    env: { ...process.env, ...command.env },
    stdio: 'inherit'
  });
  childProcesses.push(child);
  child.once('error', (error) => {
    console.error(`Failed to start ${command.name}:`, error);
    stopAll(1);
  });
  child.once('exit', (code, signal) => {
    if (!stopping) {
      stopAll(code ?? (signal ? 1 : 0));
    }
  });
}

process.once('SIGINT', () => stopAll(0));
process.once('SIGTERM', () => stopAll(0));
