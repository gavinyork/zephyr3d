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

function runBundles(evalBody: string, env: Record<string, string>) {
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', evalBody], {
    encoding: 'utf8',
    env: {
      ...process.env,
      ...env
    }
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `Node process exited with ${result.status}`);
  }
}

const DEMO_SOURCE = [
  'globalThis.__demoModuleEvalCount = (globalThis.__demoModuleEvalCount ?? 0) + 1;',
  'export class Demo {',
  '  marker = "v1";',
  '}',
  'export const demo = new Demo();'
].join('\n');

function entrySource(name: string) {
  return [
    "import { demo } from './demo';",
    `export default class ${name} {`,
    '  static demo = demo;',
    '}'
  ].join('\n');
}

describe('ScriptRegistry shared module instances', () => {
  beforeAll(() => {
    (globalThis as any).window = globalThis;
    (globalThis as any).ts = loadTypeScriptRuntime();
  });

  afterAll(() => {
    delete (globalThis as any).ts;
  });

  test('two entry bundles share one instance of a common module', async () => {
    const vfs = new MemoryFS();
    await vfs.writeFile('/mods/demo.ts', DEMO_SOURCE, { create: true, encoding: 'utf8' });
    await vfs.writeFile('/mods/startup.ts', entrySource('Startup'), { create: true, encoding: 'utf8' });
    await vfs.writeFile('/mods/character.ts', entrySource('Character'), {
      create: true,
      encoding: 'utf8'
    });

    const registry = new ScriptRegistry(vfs, '/');
    const startupUrl = await registry.resolveRuntimeUrl('/mods/startup.ts');
    const characterUrl = await registry.resolveRuntimeUrl('/mods/character.ts');
    expect(startupUrl).not.toBe(characterUrl);

    runBundles(
      [
        'const a = await import(process.env.Z3D_URL_A);',
        'const b = await import(process.env.Z3D_URL_B);',
        'if (a.default.demo !== b.default.demo) {',
        "  throw new Error('demo instances differ between entry bundles');",
        '}',
        'if (globalThis.__demoModuleEvalCount !== 1) {',
        '  throw new Error(`demo module evaluated ${globalThis.__demoModuleEvalCount} times`);',
        '}'
      ].join('\n'),
      { Z3D_URL_A: startupUrl, Z3D_URL_B: characterUrl }
    );
  });

  test('rebuilding an entry after invalidation keeps unchanged dependency instances', async () => {
    const vfs = new MemoryFS();
    await vfs.writeFile('/mods/demo.ts', DEMO_SOURCE, { create: true, encoding: 'utf8' });
    await vfs.writeFile('/mods/startup.ts', entrySource('Startup'), { create: true, encoding: 'utf8' });

    const registry = new ScriptRegistry(vfs, '/');
    const url1 = await registry.resolveRuntimeUrl('/mods/startup.ts');

    // Edit only the entry: demo.ts is unchanged and must keep its instance.
    await vfs.writeFile('/mods/startup.ts', `${entrySource('Startup')}\nexport const touched = true;`, {
      encoding: 'utf8'
    });
    registry.invalidate('/mods/startup.ts');
    const url2 = await registry.resolveRuntimeUrl('/mods/startup.ts');
    expect(url2).not.toBe(url1);

    runBundles(
      [
        'const a1 = await import(process.env.Z3D_URL_A);',
        'const a2 = await import(process.env.Z3D_URL_B);',
        'if (a1.default.demo !== a2.default.demo) {',
        "  throw new Error('unchanged dependency was re-instantiated');",
        '}',
        'if (globalThis.__demoModuleEvalCount !== 1) {',
        '  throw new Error(`demo module evaluated ${globalThis.__demoModuleEvalCount} times`);',
        '}'
      ].join('\n'),
      { Z3D_URL_A: url1, Z3D_URL_B: url2 }
    );
  });

  test('changed module content is re-evaluated after invalidation', async () => {
    const vfs = new MemoryFS();
    await vfs.writeFile('/mods/demo.ts', DEMO_SOURCE, { create: true, encoding: 'utf8' });
    await vfs.writeFile('/mods/startup.ts', entrySource('Startup'), { create: true, encoding: 'utf8' });

    const registry = new ScriptRegistry(vfs, '/');
    const url1 = await registry.resolveRuntimeUrl('/mods/startup.ts');

    // Edit the shared dependency: dependents rebuild and must see new code.
    await vfs.writeFile('/mods/demo.ts', DEMO_SOURCE.replace('"v1"', '"v2"'), { encoding: 'utf8' });
    registry.invalidate('/mods/demo.ts');
    const url2 = await registry.resolveRuntimeUrl('/mods/startup.ts');
    expect(url2).not.toBe(url1);

    runBundles(
      [
        'const a1 = await import(process.env.Z3D_URL_A);',
        'const a2 = await import(process.env.Z3D_URL_B);',
        'if (a1.default.demo === a2.default.demo) {',
        "  throw new Error('changed dependency kept its stale instance');",
        '}',
        'if (a1.default.demo.marker !== "v1" || a2.default.demo.marker !== "v2") {',
        '  throw new Error(`unexpected markers: ${a1.default.demo.marker}, ${a2.default.demo.marker}`);',
        '}'
      ].join('\n'),
      { Z3D_URL_A: url1, Z3D_URL_B: url2 }
    );
  });

  test('registries with different namespaces do not share module instances', async () => {
    const vfs = new MemoryFS();
    await vfs.writeFile('/mods/demo.ts', DEMO_SOURCE, { create: true, encoding: 'utf8' });
    await vfs.writeFile('/mods/startup.ts', entrySource('Startup'), { create: true, encoding: 'utf8' });

    const urlA = await new ScriptRegistry(vfs, '/').resolveRuntimeUrl('/mods/startup.ts');
    const urlB = await new ScriptRegistry(vfs, '/').resolveRuntimeUrl('/mods/startup.ts');

    runBundles(
      [
        'const a = await import(process.env.Z3D_URL_A);',
        'const b = await import(process.env.Z3D_URL_B);',
        'if (a.default.demo === b.default.demo) {',
        "  throw new Error('demo instances leaked across registry namespaces');",
        '}'
      ].join('\n'),
      { Z3D_URL_A: urlA, Z3D_URL_B: urlB }
    );
  });
});
