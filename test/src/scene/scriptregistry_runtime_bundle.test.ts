import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import * as vm from 'node:vm';
import { MemoryFS } from '@zephyr3d/base';
import { ScriptRegistry } from '@zephyr3d/scene';

jest.mock('@zephyr3d/scene/app/api', () => ({
  getApp: jest.fn(() => ({
    editorMode: 'editor'
  }))
}));

function loadTypeScriptRuntime() {
  const sandbox: { ts?: any } = {};
  const source = readFileSync(
    resolve(__dirname, '../../../utility/editor/public/vendor/typescript.js'),
    'utf8'
  );
  vm.runInNewContext(source, sandbox, { filename: 'typescript.js' });
  if (!sandbox.ts) {
    throw new Error('Failed to load TypeScript runtime from vendor bundle.');
  }
  return sandbox.ts;
}

describe('ScriptRegistry runtime bundle', () => {
  beforeAll(() => {
    (globalThis as any).window = globalThis;
    (globalThis as any).ts = loadTypeScriptRuntime();
  });

  afterAll(() => {
    delete (globalThis as any).ts;
  });

  test('keeps modern syntax in bundled .mjs modules', async () => {
    const vfs = new MemoryFS();
    await vfs.writeFile(
      '/mods/events.mjs',
      [
        'export const ne = Object.getPrototypeOf(',
        '  Object.getPrototypeOf(async function*(){}).prototype',
        ');',
        'export default class Demo {}'
      ].join('\n'),
      { create: true, encoding: 'utf8' }
    );

    const registry = new ScriptRegistry(vfs, '/');
    const url = await registry.resolveRuntimeUrl('/mods/events.mjs');
    expect(url.startsWith('data:text/javascript;base64,')).toBe(true);

    const payload = Buffer.from(url.split(',')[1].split('#')[0], 'base64').toString('utf8');
    expect(payload).toContain('async function*');
    expect(payload).not.toContain('__asyncGenerator');
  });

  test('keeps derived class field ordering intact in bundled .mjs modules', async () => {
    const vfs = new MemoryFS();
    await vfs.writeFile(
      '/mods/process.mjs',
      [
        'export class Base {}',
        'export default class Demo extends Base {',
        '  env = 1;',
        '  #secret = 2;',
        '  constructor() {',
        '    super();',
        '    this.x = 3;',
        '  }',
        '  readSecret() {',
        '    return this.#secret;',
        '  }',
        '}'
      ].join('\n'),
      { create: true, encoding: 'utf8' }
    );

    const registry = new ScriptRegistry(vfs, '/');
    const url = await registry.resolveRuntimeUrl('/mods/process.mjs');
    const result = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        [
          'const mod = await import(process.env.Z3D_BUNDLE_URL);',
          'const Demo = mod.default;',
          'const instance = new Demo();',
          'if (instance.env !== 1 || instance.x !== 3 || instance.readSecret() !== 2) {',
          '  throw new Error(`bad instance: ${instance.env}, ${instance.x}, ${instance.readSecret()}`);',
          '}'
        ].join('\n')
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          Z3D_BUNDLE_URL: url
        }
      }
    );

    if (result.status !== 0) {
      throw new Error(result.stderr || result.stdout || `Node process exited with ${result.status}`);
    }
  });
});
