import type { VFS } from '@zephyr3d/base';
import { VFSError, MemoryFS, ZipFS, IndexedDBFS } from '@zephyr3d/base';
import * as zipjs from '@zip.js/zip.js';

// VFS类型定义
const VFSTypes = ['MemoryFS', 'IndexedDBFS', 'ZipFS'] as const;
type VFSType = (typeof VFSTypes)[number];

// 工厂函数
function createVFS(type: VFSType, name: string = 'TestVFS', readonly = false): VFS {
  switch (type) {
    case 'MemoryFS':
      return new MemoryFS(readonly);
    case 'IndexedDBFS':
      return new IndexedDBFS(name, 'files', readonly);
    case 'ZipFS':
      return new ZipFS(zipjs, readonly);
  }
}

// 创建测试文件结构
async function createGlobTestStructure(fs: VFS) {
  // 根目录文件
  await fs.writeFile('/file1.txt', 'content1');
  await fs.writeFile('/file2.log', 'content2');
  await fs.writeFile('/File3.TXT', 'content3');
  await fs.writeFile('/readme.md', 'readme');
  await fs.writeFile('/package.json', '{"name":"test"}');
  await fs.writeFile('/.hidden', 'hidden');
  await fs.writeFile('/test.min.js', 'minified');
  await fs.writeFile('/app.js', 'app code');

  // src 目录
  await fs.makeDirectory('/src');
  await fs.writeFile('/src/index.js', 'index');
  await fs.writeFile('/src/utils.ts', 'utils');
  await fs.writeFile('/src/App.jsx', 'react app');
  await fs.writeFile('/src/styles.css', 'styles');
  await fs.writeFile('/src/config.json', 'config');

  // src/components 目录
  await fs.makeDirectory('/src/components');
  await fs.writeFile('/src/components/Button.tsx', 'button');
  await fs.writeFile('/src/components/Modal.jsx', 'modal');
  await fs.writeFile('/src/components/index.js', 'exports');
  await fs.writeFile('/src/components/.DS_Store', 'system');

  // tests 目录
  await fs.makeDirectory('/tests');
  await fs.writeFile('/tests/unit.test.js', 'unit tests');
  await fs.writeFile('/tests/integration.test.ts', 'integration tests');
  await fs.writeFile('/tests/setup.js', 'test setup');

  // docs 目录
  await fs.makeDirectory('/docs');
  await fs.writeFile('/docs/api.md', 'api docs');
  await fs.writeFile('/docs/guide.md', 'guide docs');
  await fs.makeDirectory('/docs/images');
  await fs.writeFile('/docs/images/logo.png', 'logo');
  await fs.writeFile('/docs/images/screenshot.jpg', 'screenshot');

  // node_modules 目录
  await fs.makeDirectory('/node_modules/package', true);
  await fs.writeFile('/node_modules/package/index.js', 'dependency');
}

// 使用 describe.each 为每种 VFS 类型生成测试套件
describe.each(VFSTypes)('%s Tests', (vfsType) => {
  describe('基础文件操作', () => {
    let fs: VFS;

    beforeEach(() => {
      fs = createVFS(vfsType);
    });

    afterEach(async () => {
      await fs.wipe();
    });

    test('应该能写入和读取文件', async () => {
      await fs.writeFile('/test.txt', 'Hello World');
      const content = await fs.readFile('/test.txt', { encoding: 'utf8' });
      expect(content).toBe('Hello World');
    });

    test('应该正确检查文件是否存在', async () => {
      await fs.writeFile('/test.txt', 'content');
      expect(await fs.exists('/test.txt')).toBe(true);
      expect(await fs.exists('/nonexistent.txt')).toBe(false);
    });
  });

  describe('目录操作', () => {
    let fs: VFS;

    beforeEach(() => {
      fs = createVFS(vfsType);
    });

    afterEach(async () => {
      await fs.wipe();
    });

    test('应该能创建目录', async () => {
      await fs.makeDirectory('/testdir');
      expect(await fs.exists('/testdir')).toBe(true);
    });

    test('应该能列举目录内容', async () => {
      await fs.makeDirectory('/testdir');
      await fs.writeFile('/testdir/file.txt', 'content');
      const entries = await fs.readDirectory('/testdir');
      expect(entries).toHaveLength(1);
      expect(entries[0].name).toBe('file.txt');
    });
  });

  describe('挂载操作', () => {
    let rootFS: VFS;
    let subFS: VFS;

    beforeEach(() => {
      rootFS = createVFS(vfsType, `${vfsType}_root`);
      subFS = createVFS(vfsType, `${vfsType}_sub`);
    });

    afterEach(async () => {
      await rootFS.wipe();
      await subFS.wipe();
    });

    test('应该能挂载和访问子文件系统', async () => {
      await subFS.writeFile('/sub-file.txt', 'sub content');
      await rootFS.mount('/mnt', subFS);

      expect(rootFS.hasMounts()).toBe(true);

      const content = await rootFS.readFile('/mnt/sub-file.txt', { encoding: 'utf8' });
      expect(content).toBe('sub content');
    });

    test('应该能卸载文件系统', async () => {
      await subFS.writeFile('/sub-file.txt', 'sub content');
      await rootFS.mount('/mnt', subFS);

      const result = await rootFS.unmount('/mnt');
      expect(result).toBe(true);
      expect(rootFS.hasMounts()).toBe(false);
    });

    test('不应该允许删除挂载点', async () => {
      await subFS.writeFile('/sub-file.txt', 'sub content');
      await rootFS.mount('/mnt', subFS);

      await expect(rootFS.deleteDirectory('/mnt')).rejects.toThrow(VFSError);
    });
  });

  describe('文件复制', () => {
    let fs: VFS;

    beforeEach(() => {
      fs = createVFS(vfsType);
    });

    afterEach(async () => {
      await fs.wipe();
    });

    test('应该能复制文件', async () => {
      await fs.writeFile('/source.txt', 'original content');
      await fs.copyFile('/source.txt', '/copy.txt');

      const copyContent = await fs.readFile('/copy.txt', { encoding: 'utf8' });
      expect(copyContent).toBe('original content');
      expect(await fs.exists('/source.txt')).toBe(true);
    });
  });

  describe('错误处理', () => {
    let fs: VFS;

    beforeEach(() => {
      fs = createVFS(vfsType);
    });

    afterEach(async () => {
      await fs.wipe();
    });

    test('读取不存在的文件应该抛出错误', async () => {
      await expect(fs.readFile('/nonexistent.txt')).rejects.toThrow(VFSError);
    });

    test('只读文件系统不应允许写入', async () => {
      const readOnlyFS = createVFS(vfsType, `${vfsType}_readonly`, true);
      await expect(readOnlyFS.writeFile('/test.txt', 'content')).rejects.toThrow(VFSError);
    });
  });

  describe('二进制数据', () => {
    let fs: VFS;

    beforeEach(() => {
      fs = createVFS(vfsType);
    });

    afterEach(async () => {
      await fs.wipe();
    });

    test('应该能处理二进制数据', async () => {
      const binaryData = new Uint8Array([1, 2, 3, 4, 5]);
      await fs.writeFile('/binary.dat', binaryData.buffer);

      const readData = await fs.readFile('/binary.dat');
      expect(readData).toBeInstanceOf(ArrayBuffer);

      const readArray = new Uint8Array(readData as ArrayBuffer);
      expect(readArray).toEqual(binaryData);
    });

    test('应该能追加二进制数据', async () => {
      const data1 = new Uint8Array([1, 2, 3]);
      const data2 = new Uint8Array([4, 5, 6]);
      const expected = new Uint8Array([1, 2, 3, 4, 5, 6]);

      await fs.writeFile('/binary-append.dat', data1.buffer);
      await fs.writeFile('/binary-append.dat', data2.buffer, { append: true });

      const readData = await fs.readFile('/binary-append.dat');
      const readArray = new Uint8Array(readData as ArrayBuffer);
      expect(readArray).toEqual(expected);
    });
  });

  describe('文件移动', () => {
    let fs: VFS;

    beforeEach(() => {
      fs = createVFS(vfsType);
    });

    afterEach(async () => {
      await fs.wipe();
    });

    test('应该能重命名文件', async () => {
      await fs.writeFile('/source.txt', 'Hello World');
      await fs.move('/source.txt', '/renamed.txt');

      expect(await fs.exists('/renamed.txt')).toBe(true);
      expect(await fs.exists('/source.txt')).toBe(false);

      const content = await fs.readFile('/renamed.txt', { encoding: 'utf8' });
      expect(content).toBe('Hello World');
    });

    test('应该能移动目录', async () => {
      await fs.makeDirectory('/testdir');
      await fs.writeFile('/testdir/nested.txt', 'nested content');
      await fs.move('/testdir', '/newdir');

      expect(await fs.exists('/newdir')).toBe(true);
      expect(await fs.exists('/testdir')).toBe(false);
      expect(await fs.exists('/newdir/nested.txt')).toBe(true);
    });

    test('默认不应覆盖已存在的文件', async () => {
      await fs.writeFile('/source.txt', 'source content');
      await fs.writeFile('/target.txt', 'target content');

      await expect(fs.move('/source.txt', '/target.txt')).rejects.toThrow(VFSError);
    });

    test('设置overwrite后应该能覆盖文件', async () => {
      await fs.writeFile('/source.txt', 'source content');
      await fs.writeFile('/target.txt', 'target content');

      await fs.move('/source.txt', '/target.txt', { overwrite: true });

      expect(await fs.exists('/target.txt')).toBe(true);
      expect(await fs.exists('/source.txt')).toBe(false);

      const content = await fs.readFile('/target.txt', { encoding: 'utf8' });
      expect(content).toBe('source content');
    });
  });

  describe('Glob 操作', () => {
    let fs: VFS;

    beforeEach(async () => {
      fs = createVFS(vfsType);
      await createGlobTestStructure(fs);
    });

    afterEach(async () => {
      await fs.wipe();
    });

    test('* 通配符应该匹配文件', async () => {
      const txtFiles = await fs.glob('*.txt');
      const txtNames = txtFiles.map((r) => r.name).sort();
      expect(txtNames).toEqual(['file1.txt']);
    });

    test('** 通配符应该递归匹配', async () => {
      const allJsFiles = await fs.glob('**/*.js');
      expect(allJsFiles.length).toBeGreaterThanOrEqual(5);

      const paths = allJsFiles.map((r) => r.relativePath);
      expect(paths).toContain('src/index.js');
      expect(paths).toContain('src/components/index.js');
    });

    test('应该能忽略指定模式', async () => {
      const withoutMin = await fs.glob('**/*.js', { ignore: '**/*.min.js' });
      const names = withoutMin.map((r) => r.name);
      expect(names).not.toContain('test.min.js');
    });
  });

  describe('工作目录（CWD）', () => {
    let fs: VFS;

    beforeEach(() => {
      fs = createVFS(vfsType);
    });

    afterEach(async () => {
      await fs.wipe();
    });

    test('默认工作目录应该是根目录', () => {
      expect(fs.getCwd()).toBe('/');
    });

    test('应该能切换工作目录', async () => {
      await fs.makeDirectory('/home/user', true);
      await fs.chdir('/home/user');
      expect(fs.getCwd()).toBe('/home/user');
    });

    test('应该能用相对路径操作文件', async () => {
      await fs.makeDirectory('/home/user', true);
      await fs.chdir('/home/user');
      await fs.writeFile('test.txt', 'test content');

      expect(await fs.exists('/home/user/test.txt')).toBe(true);
    });

    test('pushd 和 popd 应该正常工作', async () => {
      await fs.makeDirectory('/home/user', true);
      await fs.makeDirectory('/tmp', true);

      await fs.chdir('/home/user');
      await fs.pushd('/tmp');
      expect(fs.getCwd()).toBe('/tmp');

      await fs.popd();
      expect(fs.getCwd()).toBe('/home/user');
    });

    test('空栈 popd 应该抛出错误', async () => {
      await expect(fs.popd()).rejects.toThrow(VFSError);
    });
  });

  describe('文件状态', () => {
    let fs: VFS;

    beforeEach(() => {
      fs = createVFS(vfsType);
    });

    afterEach(async () => {
      await fs.wipe();
    });

    test('应该能获取文件状态', async () => {
      await fs.writeFile('/file.txt', 'content');
      const stat = await fs.stat('/file.txt');

      expect(stat.isFile).toBe(true);
      expect(stat.isDirectory).toBe(false);
      expect(stat.size).toBeGreaterThan(0);
      expect(stat.created).toBeInstanceOf(Date);
      expect(stat.modified).toBeInstanceOf(Date);
    });

    test('应该能获取目录状态', async () => {
      await fs.makeDirectory('/directory');
      const stat = await fs.stat('/directory');

      expect(stat.isFile).toBe(false);
      expect(stat.isDirectory).toBe(true);
    });
  });
});
