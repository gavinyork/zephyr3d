import type { TypedArray, VFS } from '@zephyr3d/base';
import { VFSError, MemoryFS, ZipFS, IndexedDBFS } from '@zephyr3d/base';
import * as zipjs from '@zip.js/zip.js';

let currentTest = 0;

// 简单的测试工具函数
function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`断言失败: ${message}`);
  }
}

function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    throw new Error(`断言失败: ${message}. 期望: ${expected}, 实际: ${actual}`);
  }
}

function assertArrayEqual(actual: TypedArray | unknown[], expected: TypedArray | unknown[], message: string) {
  if (actual.length !== expected.length) {
    throw new Error(`断言失败: ${message}. 数组长度不匹配，期望: ${expected.length}, 实际: ${actual.length}`);
  }
  for (let i = 0; i < expected.length; i++) {
    if (actual[i] !== expected[i]) {
      throw new Error(`断言失败: ${message}. 索引 ${i} 处值不匹配，期望: ${expected[i]}, 实际: ${actual[i]}`);
    }
  }
}

function assertContains(array: unknown[], item: unknown, message: string) {
  if (!array.includes(item)) {
    throw new Error(`断言失败: ${message}. 数组不包含: ${item}`);
  }
}

function assertNotContains(array: unknown[], item: unknown, message: string) {
  if (array.includes(item)) {
    throw new Error(`断言失败: ${message}. 数组不应包含: ${item}`);
  }
}

// 测试运行器
async function runTest(testName: string, testFn: () => void) {
  try {
    console.log(`🧪 开始测试: ${testName}`);
    await testFn();
    console.log(`✅ 通过: ${testName}`);
    return true;
  } catch (error) {
    console.log(`❌ 失败: ${testName}`);
    console.log(`   错误: ${error}`);
    return false;
  }
}

const VFSTypes = ['Memory VFS', 'IndexedDB VFS', 'Zip VFS'];

function createVFS(name: string = 'TestVFS', readonly = false) {
  if (currentTest === 0) {
    return new MemoryFS(readonly);
  } else if (currentTest === 1) {
    return new IndexedDBFS(name, 'files', readonly);
  } else {
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

// VFS 基础功能测试
async function testBasicFileOperations() {
  const fs = createVFS();

  // 写入和读取文件
  await fs.writeFile('/test.txt', 'Hello World');
  const content = await fs.readFile('/test.txt', { encoding: 'utf8' });
  assertEqual(content, 'Hello World', '文件内容应该匹配');
  /*
  // 检查文件是否存在
  assert(await fs.exists('/test.txt'), '文件应该存在');
  assert(!(await fs.exists('/nonexistent.txt')), '不存在的文件应该返回false');

  console.log('   - 文件写入/读取: 正常');
  console.log('   - 文件存在检查: 正常');
*/
  await fs.wipe();
}

async function testDirectoryOperations() {
  const fs = createVFS();

  // 创建目录
  await fs.makeDirectory('/testdir');
  assert(await fs.exists('/testdir'), '目录应该存在');

  // 在目录中创建文件
  await fs.writeFile('/testdir/file.txt', 'content');
  const entries = await fs.readDirectory('/testdir');
  assertEqual(entries.length, 1, '目录应该包含一个文件');
  assertEqual(entries[0].name, 'file.txt', '文件名应该匹配');

  console.log('   - 目录创建: 正常');
  console.log('   - 目录列举: 正常');

  await fs.wipe();
}

async function testMountOperations() {
  const rootFS = createVFS('root');
  const subFS = createVFS('sub');

  // 在子文件系统中创建文件
  await subFS.writeFile('/sub-file.txt', 'sub content');

  // 挂载子文件系统
  rootFS.mount('/mnt', subFS);
  assert(rootFS.hasMounts(), '应该有挂载点');

  // 通过根文件系统访问挂载的文件
  const content = await rootFS.readFile('/mnt/sub-file.txt', { encoding: 'utf8' });
  assertEqual(content, 'sub content', '挂载文件内容应该匹配');

  // 卸载
  const result = rootFS.unmount('/mnt');
  assert(result, '卸载应该成功');
  assert(!rootFS.hasMounts(), '卸载后不应该有挂载点');

  console.log('   - 文件系统挂载: 正常');
  console.log('   - 文件系统卸载: 正常');

  await rootFS.wipe();
  await subFS.wipe();
}

async function testFileCopy() {
  const fs = createVFS();

  // 创建源文件
  await fs.writeFile('/source.txt', 'original content');

  // 复制文件
  await fs.copyFile('/source.txt', '/copy.txt');
  const copyContent = await fs.readFile('/copy.txt', { encoding: 'utf8' });
  assertEqual(copyContent, 'original content', '复制的文件内容应该匹配');
  assert(await fs.exists('/source.txt'), '原文件应该仍然存在');

  console.log('   - 文件复制: 正常');

  await fs.wipe();
}

async function testErrorHandling() {
  const fs = createVFS();

  // 测试读取不存在的文件
  try {
    await fs.readFile('/nonexistent.txt');
    throw new VFSError('应该抛出错误');
  } catch (error) {
    assert(error instanceof VFSError, '应该抛出 VFSError');
  }

  // 测试只读文件系统
  const readOnlyFS = createVFS('ReadOnlyFS', true);
  try {
    await readOnlyFS.writeFile('/test.txt', 'content');
    throw new VFSError('应该抛出错误');
  } catch (error) {
    assert(error instanceof VFSError, '应该抛出 VFSError');
  }

  console.log('   - 错误处理: 正常');

  await fs.wipe();
}

async function testBinaryData() {
  const fs = createVFS();

  // 创建二进制数据
  const binaryData = new Uint8Array([1, 2, 3, 4, 5]);

  // 写入二进制数据
  await fs.writeFile('/binary.dat', binaryData.buffer);

  // 读取二进制数据 - 不指定编码，应该返回 ArrayBuffer
  const readData = await fs.readFile('/binary.dat');

  // 类型检查和转换
  if (typeof readData === 'string') {
    throw new Error('读取二进制数据不应该返回字符串');
  }

  const readArray = new Uint8Array(readData as ArrayBuffer);

  // 比较数据
  assertEqual(readArray.length, binaryData.length, '二进制数据长度应该匹配');
  for (let i = 0; i < binaryData.length; i++) {
    assertEqual(readArray[i], binaryData[i], `字节 ${i} 应该匹配`);
  }

  console.log('   - 二进制数据处理: 正常');
  await fs.wipe();
}

async function testBinaryDataAppend() {
  const fs = createVFS();

  // 测试 ArrayBuffer + ArrayBuffer 追加
  const data1 = new Uint8Array([1, 2, 3]);
  const data2 = new Uint8Array([4, 5, 6]);
  const expected = new Uint8Array([1, 2, 3, 4, 5, 6]);

  // 写入初始二进制数据
  await fs.writeFile('/binary-append.dat', data1.buffer);

  // 追加更多二进制数据
  await fs.writeFile('/binary-append.dat', data2.buffer, { append: true });

  // 读取合并后的数据
  const readData = await fs.readFile('/binary-append.dat');

  // 类型检查
  if (typeof readData === 'string') {
    throw new Error('读取二进制数据不应该返回字符串');
  }

  const readArray = new Uint8Array(readData);
  assertArrayEqual(readArray, expected, '追加后的二进制数据应该正确合并');

  // 测试混合类型追加：ArrayBuffer + 字符串
  const textData = 'Hello';
  await fs.writeFile('/mixed-append.dat', data1.buffer);
  await fs.writeFile('/mixed-append.dat', textData, { append: true });

  const mixedResult = await fs.readFile('/mixed-append.dat', { encoding: 'utf8' });
  // 应该转换为字符串形式
  assert(typeof mixedResult === 'string', '混合追加结果应该是字符串');
  console.log(`   - 混合追加结果: "${mixedResult}"`);

  // 测试字符串 + ArrayBuffer 追加
  await fs.writeFile('/mixed-append2.dat', 'Start:');
  await fs.writeFile('/mixed-append2.dat', data1.buffer, { append: true });

  const mixedResult2 = await fs.readFile('/mixed-append2.dat', { encoding: 'utf8' });
  assert(typeof mixedResult2 === 'string', '反向混合追加结果也应该是字符串');
  console.log(`   - 反向混合追加结果: "${mixedResult2}"`);

  console.log('   - 二进制数据追加: 正常');
  console.log('   - 混合类型追加: 正常');

  await fs.wipe();
}

async function testMountPriority() {
  const rootFS = createVFS('root');
  const fs1 = createVFS('child1');
  const fs2 = createVFS('child2');

  // 在两个文件系统中创建同名文件
  await fs1.writeFile('/file.txt', 'from fs1');
  await fs2.writeFile('/file.txt', 'from fs2');

  // 创建嵌套挂载
  rootFS.mount('/mnt', fs1);
  rootFS.mount('/mnt/deep', fs2);

  // 测试路径优先级
  const deepContent = await rootFS.readFile('/mnt/deep/file.txt', { encoding: 'utf8' });
  assertEqual(deepContent, 'from fs2', '应该访问更深的挂载点');

  const shallowContent = await rootFS.readFile('/mnt/file.txt', { encoding: 'utf8' });
  assertEqual(shallowContent, 'from fs1', '应该访问较浅的挂载点');

  console.log('   - 挂载优先级: 正常');
  await rootFS.wipe();
  await fs1.wipe();
  await fs2.wipe();
}

async function testCrossMountOperations() {
  const rootFS = createVFS('root');
  const fs1 = createVFS('child1');
  const fs2 = createVFS('child2');

  rootFS.mount('/fs1', fs1);
  rootFS.mount('/fs2', fs2);

  // 在第一个挂载点创建文件
  await rootFS.writeFile('/fs1/source.txt', 'cross mount data');

  // 复制到第二个挂载点
  await rootFS.copyFile('/fs1/source.txt', '/fs2/dest.txt');

  // 验证文件在第二个文件系统中
  const content = await fs2.readFile('/dest.txt', { encoding: 'utf8' });
  assertEqual(content, 'cross mount data', '跨挂载复制应该成功');

  console.log('   - 跨挂载操作: 正常');
  await rootFS.wipe();
  await fs1.wipe();
  await fs2.wipe();
}

async function testFileOptions() {
  const fs = createVFS();

  // 测试不同编码选项
  await fs.writeFile('/text.txt', 'Hello World');

  // 明确指定 utf8 编码
  const textContent = await fs.readFile('/text.txt', { encoding: 'utf8' });
  assert(typeof textContent === 'string', '指定 utf8 编码应该返回字符串');
  assertEqual(textContent, 'Hello World', '文本内容应该匹配');

  // 不指定编码（应该返回 ArrayBuffer）
  const binaryContent = await fs.readFile('/text.txt');
  assert(
    binaryContent instanceof ArrayBuffer || typeof binaryContent === 'string',
    '不指定编码应该返回原始数据'
  );

  // 测试文件追加
  await fs.writeFile('/append.txt', 'Hello');
  await fs.writeFile('/append.txt', ' World', { append: true });
  const appendedContent = await fs.readFile('/append.txt', { encoding: 'utf8' });
  assertEqual(appendedContent, 'Hello World', '追加内容应该正确');

  console.log('   - 文件选项处理: 正常');
  await fs.wipe();
}

async function testStatOperations() {
  const fs = createVFS();

  // 创建文件和目录
  await fs.writeFile('/file.txt', 'content');
  await fs.makeDirectory('/directory');

  // 获取文件状态
  const fileStat = await fs.stat('/file.txt');
  assert(fileStat.isFile, '应该识别为文件');
  assert(!fileStat.isDirectory, '不应该识别为目录');
  assert(fileStat.size > 0, '文件大小应该大于0');
  assert(fileStat.created instanceof Date, 'created 应该是 Date 对象');
  assert(fileStat.modified instanceof Date, 'modified 应该是 Date 对象');

  // 获取目录状态
  const dirStat = await fs.stat('/directory');
  assert(!dirStat.isFile, '不应该识别为文件');
  assert(dirStat.isDirectory, '应该识别为目录');

  console.log('   - 文件状态查询: 正常');
  await fs.wipe();
}

async function testLargeFileOperations() {
  const fs = createVFS();

  // 测试大型二进制文件的追加
  const chunkSize = 1000;
  const numChunks = 5;

  // 创建多个数据块
  const chunks = [];
  let expectedData = new Uint8Array(0);

  for (let i = 0; i < numChunks; i++) {
    const chunk = new Uint8Array(chunkSize);
    // 填充测试数据
    for (let j = 0; j < chunkSize; j++) {
      chunk[j] = (i * chunkSize + j) % 256;
    }
    chunks.push(chunk);

    // 构建期望的完整数据
    const newExpected = new Uint8Array(expectedData.length + chunkSize);
    newExpected.set(expectedData, 0);
    newExpected.set(chunk, expectedData.length);
    expectedData = newExpected;
  }

  // 写入第一个块
  await fs.writeFile('/large-file.dat', chunks[0].buffer);

  // 追加剩余的块
  for (let i = 1; i < numChunks; i++) {
    await fs.writeFile('/large-file.dat', chunks[i].buffer, { append: true });
  }

  // 验证最终文件
  const finalData = await fs.readFile('/large-file.dat');
  assert(finalData instanceof ArrayBuffer, '大文件应该返回 ArrayBuffer');

  const finalArray = new Uint8Array(finalData as ArrayBuffer);
  assertEqual(finalArray.length, expectedData.length, '大文件长度应该匹配');

  // 抽样验证数据（避免逐字节比较太耗时）
  for (let i = 0; i < expectedData.length; i += 100) {
    assertEqual(finalArray[i], expectedData[i], `大文件索引 ${i} 处数据应该匹配`);
  }

  console.log('   - 大型文件追加: 正常');
  console.log(`   - 处理了 ${numChunks} 个 ${chunkSize} 字节的块`);
  await fs.wipe();
}

async function testMoveBasicOperations() {
  const fs = createVFS('MoveBasicTest');

  // 创建测试文件和目录
  await fs.writeFile('/source.txt', 'Hello World');
  await fs.makeDirectory('/testdir');
  await fs.writeFile('/testdir/nested.txt', 'nested content');

  // 测试文件重命名
  await fs.move('/source.txt', '/renamed.txt');
  assert(await fs.exists('/renamed.txt'), '重命名后的文件应该存在');
  assert(!(await fs.exists('/source.txt')), '原文件应该不存在');

  const content = await fs.readFile('/renamed.txt', { encoding: 'utf8' });
  assertEqual(content, 'Hello World', '重命名文件内容应该保持不变');

  // 测试目录重命名
  await fs.move('/testdir', '/newdir');
  assert(await fs.exists('/newdir'), '重命名后的目录应该存在');
  assert(!(await fs.exists('/testdir')), '原目录应该不存在');
  assert(await fs.exists('/newdir/nested.txt'), '目录内的文件应该还在');

  console.log('   - 文件重命名: 正常');
  console.log('   - 目录重命名: 正常');
  console.log('   - 内容保持: 正常');

  await fs.wipe();
}

async function testMoveToDirectory() {
  const fs = createVFS('MoveToDirectoryTest');

  // 创建测试结构
  await fs.writeFile('/file1.txt', 'content1');
  await fs.writeFile('/file2.txt', 'content2');
  await fs.makeDirectory('/target');
  await fs.makeDirectory('/source');
  await fs.writeFile('/source/nested.txt', 'nested');

  // 测试文件移动到目录
  await fs.move('/file1.txt', '/target/file1.txt');
  assert(await fs.exists('/target/file1.txt'), '文件应该移动到目标目录');
  assert(!(await fs.exists('/file1.txt')), '原文件应该不存在');

  // 测试目录移动到另一个目录
  await fs.move('/source', '/target/source');
  assert(await fs.exists('/target/source'), '目录应该移动到目标位置');
  assert(await fs.exists('/target/source/nested.txt'), '嵌套文件应该还在');
  assert(!(await fs.exists('/source')), '原目录应该不存在');

  console.log('   - 文件移动到目录: 正常');
  console.log('   - 目录移动到目录: 正常');

  await fs.wipe();
}

async function testMoveComplexDirectory() {
  const fs = createVFS('MoveComplexTest');

  // 创建复杂的目录结构
  await fs.makeDirectory('/project/src/components', true);
  await fs.makeDirectory('/project/tests/unit', true);
  await fs.writeFile('/project/src/app.js', 'app code');
  await fs.writeFile('/project/src/utils.js', 'utils');
  await fs.writeFile('/project/src/components/Button.jsx', 'button');
  await fs.writeFile('/project/src/components/Modal.jsx', 'modal');
  await fs.writeFile('/project/tests/app.test.js', 'app test');
  await fs.writeFile('/project/tests/unit/utils.test.js', 'utils test');
  await fs.writeFile('/project/package.json', 'package');

  // 移动整个项目目录
  await fs.move('/project', '/workspace');

  // 验证所有文件都被正确移动
  assert(await fs.exists('/workspace'), '项目目录应该移动成功');
  assert(!(await fs.exists('/project')), '原项目目录应该不存在');

  // 验证深层嵌套文件
  assert(await fs.exists('/workspace/src/app.js'), '根级源文件应该存在');
  assert(await fs.exists('/workspace/src/components/Button.jsx'), '深层组件文件应该存在');
  assert(await fs.exists('/workspace/tests/unit/utils.test.js'), '最深层测试文件应该存在');

  // 验证文件内容
  const appContent = await fs.readFile('/workspace/src/app.js', { encoding: 'utf8' });
  assertEqual(appContent, 'app code', '移动后文件内容应该保持不变');

  const buttonContent = await fs.readFile('/workspace/src/components/Button.jsx', { encoding: 'utf8' });
  assertEqual(buttonContent, 'button', '深层文件内容应该保持不变');

  console.log('   - 复杂目录结构移动: 正常');
  console.log('   - 深层嵌套文件保持: 正常');
  console.log('   - 移动后内容完整: 正常');

  await fs.wipe();
}

async function testMoveOverwrite() {
  const fs = createVFS('MoveOverwriteTest');

  // 创建源文件和目标文件
  await fs.writeFile('/source.txt', 'source content');
  await fs.writeFile('/target.txt', 'target content');

  // 创建源目录和目标目录
  await fs.makeDirectory('/sourcedir');
  await fs.writeFile('/sourcedir/file.txt', 'source dir file');
  await fs.makeDirectory('/targetdir');
  await fs.writeFile('/targetdir/file.txt', 'target dir file');

  // 测试不允许覆盖（默认行为）
  try {
    await fs.move('/source.txt', '/target.txt');
    throw new Error('应该抛出错误');
  } catch (error) {
    assert(error instanceof VFSError, '不允许覆盖应该抛出 VFSError');
    assertEqual(error['code'], 'EEXIST', '错误代码应该是 EEXIST');
  }

  // 测试允许覆盖文件
  await fs.move('/source.txt', '/target.txt', { overwrite: true });
  assert(await fs.exists('/target.txt'), '目标文件应该存在');
  assert(!(await fs.exists('/source.txt')), '源文件应该不存在');

  const content = await fs.readFile('/target.txt', { encoding: 'utf8' });
  assertEqual(content, 'source content', '目标文件应该包含源文件内容');

  // 测试允许覆盖目录
  await fs.move('/sourcedir', '/targetdir', { overwrite: true });
  assert(await fs.exists('/targetdir'), '目标目录应该存在');
  assert(!(await fs.exists('/sourcedir')), '源目录应该不存在');

  const dirContent = await fs.readFile('/targetdir/file.txt', { encoding: 'utf8' });
  assertEqual(dirContent, 'source dir file', '目标目录应该包含源目录内容');

  console.log('   - 默认不覆盖: 正常');
  console.log('   - 文件覆盖: 正常');
  console.log('   - 目录覆盖: 正常');

  await fs.wipe();
}

async function testMoveErrorHandling() {
  const fs = createVFS('MoveErrorTest');

  // 创建测试文件和目录
  await fs.writeFile('/file.txt', 'content');
  await fs.makeDirectory('/dir');
  await fs.writeFile('/dir/nested.txt', 'nested');

  // 测试移动不存在的文件
  try {
    await fs.move('/nonexistent.txt', '/target.txt');
    throw new Error('应该抛出错误');
  } catch (error) {
    assert(error instanceof VFSError, '移动不存在文件应该抛出 VFSError');
    assertEqual(error['code'], 'ENOENT', '错误代码应该是 ENOENT');
  }

  // 测试移动根目录
  try {
    await fs.move('/', '/newroot');
    throw new Error('应该抛出错误');
  } catch (error) {
    assert(error instanceof VFSError, '移动根目录应该抛出 VFSError');
    assertEqual(error['code'], 'EINVAL', '错误代码应该是 EINVAL');
  }

  // 测试移动到根目录
  try {
    await fs.move('/file.txt', '/');
    throw new Error('应该抛出错误');
  } catch (error) {
    assert(error instanceof VFSError, '移动到根目录应该抛出 VFSError');
    assertEqual(error['code'], 'EINVAL', '错误代码应该是 EINVAL');
  }

  // 测试移动到自己的子目录
  try {
    await fs.move('/dir', '/dir/subdir');
    throw new Error('应该抛出错误');
  } catch (error) {
    assert(error instanceof VFSError, '移动到子目录应该抛出 VFSError');
    assertEqual(error['code'], 'EINVAL', '错误代码应该是 EINVAL');
  }

  // 测试文件与目录类型不匹配
  try {
    await fs.move('/file.txt', '/dir', { overwrite: true });
    throw new Error('应该抛出错误');
  } catch (error) {
    assert(error instanceof VFSError, '类型不匹配应该抛出 VFSError');
    assertEqual(error['code'], 'EISDIR', '错误代码应该是 EISDIR');
  }

  // 测试移动到不存在的父目录
  try {
    await fs.move('/file.txt', '/nonexistent/file.txt');
    throw new Error('应该抛出错误');
  } catch (error) {
    assert(error instanceof VFSError, '父目录不存在应该抛出 VFSError');
    assertEqual(error['code'], 'ENOENT', '错误代码应该是 ENOENT');
  }

  console.log('   - 不存在文件错误: 正常');
  console.log('   - 根目录限制: 正常');
  console.log('   - 子目录限制: 正常');
  console.log('   - 类型匹配检查: 正常');
  console.log('   - 父目录检查: 正常');

  await fs.wipe();
}

async function testMoveCrossVFSRestriction() {
  const rootFS = createVFS('RootFS');
  const subFS1 = createVFS('SubFS1');
  const subFS2 = createVFS('SubFS2');

  // 在不同的VFS中创建文件
  await subFS1.writeFile('/file1.txt', 'content1');
  await subFS2.writeFile('/file2.txt', 'content2');

  // 挂载两个VFS
  rootFS.mount('/vfs1', subFS1);
  rootFS.mount('/vfs2', subFS2);

  // 测试跨VFS移动应该失败
  try {
    await rootFS.move('/vfs1/file1.txt', '/vfs2/file1.txt');
    throw new Error('应该抛出错误');
  } catch (error) {
    assert(error instanceof VFSError, '跨VFS移动应该抛出 VFSError');
    assertEqual(error['code'], 'EXDEV', '错误代码应该是 EXDEV');
  }

  // 测试从挂载点移动到根VFS也应该失败
  try {
    await rootFS.move('/vfs1/file1.txt', '/moved.txt');
    throw new Error('应该抛出错误');
  } catch (error) {
    assert(error instanceof VFSError, '跨VFS移动应该抛出 VFSError');
    assertEqual(error['code'], 'EXDEV', '错误代码应该是 EXDEV');
  }

  // 测试同一VFS内的移动应该成功
  await rootFS.move('/vfs1/file1.txt', '/vfs1/renamed.txt');
  assert(await rootFS.exists('/vfs1/renamed.txt'), '同VFS内移动应该成功');
  assert(!(await rootFS.exists('/vfs1/file1.txt')), '原文件应该不存在');

  console.log('   - 跨VFS移动限制: 正常');
  console.log('   - 同VFS内移动: 正常');

  await rootFS.wipe();
  await subFS1.wipe();
  await subFS2.wipe();
}

async function testMoveWithRelativePaths() {
  const fs = createVFS('MoveRelativeTest');

  // 创建目录结构
  await fs.makeDirectory('/project/src', true);
  await fs.makeDirectory('/project/build', true);
  await fs.writeFile('/project/src/app.js', 'app code');
  await fs.writeFile('/project/temp.txt', 'temp');

  // 设置工作目录
  await fs.chdir('/project');

  // 测试相对路径移动
  await fs.move('temp.txt', 'src/temp.txt');
  assert(await fs.exists('/project/src/temp.txt'), '相对路径移动应该成功');
  assert(!(await fs.exists('/project/temp.txt')), '原文件应该不存在');

  // 测试混合绝对和相对路径
  await fs.move('/project/src/app.js', 'build/app.js');
  assert(await fs.exists('/project/build/app.js'), '混合路径移动应该成功');
  assert(!(await fs.exists('/project/src/app.js')), '原文件应该不存在');

  // 测试 .. 相对路径
  await fs.chdir('/project/build');
  await fs.move('app.js', '../app.js');
  assert(await fs.exists('/project/app.js'), '.. 路径移动应该成功');
  assert(!(await fs.exists('/project/build/app.js')), '原文件应该不存在');

  console.log('   - 相对路径移动: 正常');
  console.log('   - 混合路径移动: 正常');
  console.log('   - .. 路径移动: 正常');

  await fs.wipe();
}

async function testMovePreservesMetadata() {
  const fs = createVFS('MoveMetadataTest');

  // 创建文件并等待一段时间以确保时间戳不同
  await fs.writeFile('/original.txt', 'content');
  const originalStat = await fs.stat('/original.txt');

  // 等待一小段时间
  await new Promise((resolve) => setTimeout(resolve, 10));

  // 移动文件
  await fs.move('/original.txt', '/moved.txt');
  const movedStat = await fs.stat('/moved.txt');

  // 验证创建时间保持不变，修改时间已更新
  assertEqual(originalStat.created.getTime(), movedStat.created.getTime(), '创建时间应该保持不变');
  assert(movedStat.modified >= originalStat.modified, '修改时间应该被更新');
  assertEqual(originalStat.size, movedStat.size, '文件大小应该保持不变');
  assertEqual(originalStat.isFile, movedStat.isFile, '文件类型应该保持不变');

  // 测试目录元数据
  await fs.makeDirectory('/testdir');
  const originalDirStat = await fs.stat('/testdir');

  await new Promise((resolve) => setTimeout(resolve, 10));

  await fs.move('/testdir', '/moveddir');
  const movedDirStat = await fs.stat('/moveddir');

  assertEqual(originalDirStat.created.getTime(), movedDirStat.created.getTime(), '目录创建时间应该保持不变');
  assert(movedDirStat.modified >= originalDirStat.modified, '目录修改时间应该被更新');
  assertEqual(originalDirStat.isDirectory, movedDirStat.isDirectory, '目录类型应该保持不变');

  console.log('   - 文件元数据保持: 正常');
  console.log('   - 目录元数据保持: 正常');
  console.log('   - 修改时间更新: 正常');

  await fs.wipe();
}

async function testMoveLargeFiles() {
  const fs = createVFS('MoveLargeTest');

  // 创建大文件（1MB）
  const largeContent = 'x'.repeat(1024 * 1024);
  await fs.writeFile('/large.txt', largeContent);

  const startTime = Date.now();
  await fs.move('/large.txt', '/moved_large.txt');
  const endTime = Date.now();

  // 验证文件移动成功且内容完整
  assert(await fs.exists('/moved_large.txt'), '大文件应该移动成功');
  assert(!(await fs.exists('/large.txt')), '原大文件应该不存在');

  const movedContent = await fs.readFile('/moved_large.txt', { encoding: 'utf8' });
  assertEqual(movedContent, largeContent, '大文件内容应该完整');

  // 移动应该很快（因为不拷贝内容）
  const moveTime = endTime - startTime;
  console.log(`   - 大文件移动时间: ${moveTime}ms`);
  assert(moveTime < 1000, '大文件移动应该很快');

  console.log('   - 大文件移动: 正常');
  console.log('   - 内容完整性: 正常');
  console.log('   - 性能表现: 正常');

  await fs.wipe();
}

async function testMoveBinaryFiles() {
  const fs = createVFS('MoveBinaryTest');

  // 创建二进制数据
  const binaryData = new ArrayBuffer(256);
  const view = new Uint8Array(binaryData);
  for (let i = 0; i < 256; i++) {
    view[i] = i;
  }

  await fs.writeFile('/binary.dat', binaryData);
  await fs.move('/binary.dat', '/moved_binary.dat');

  // 验证二进制文件移动成功
  assert(await fs.exists('/moved_binary.dat'), '二进制文件应该移动成功');
  assert(!(await fs.exists('/binary.dat')), '原二进制文件应该不存在');

  const movedData = (await fs.readFile('/moved_binary.dat')) as ArrayBuffer;
  const movedView = new Uint8Array(movedData);

  assertEqual(movedData.byteLength, 256, '二进制数据长度应该正确');
  for (let i = 0; i < 256; i++) {
    assertEqual(movedView[i], i, `字节 ${i} 应该正确`);
  }

  console.log('   - 二进制文件移动: 正常');
  console.log('   - 二进制数据完整: 正常');

  await fs.wipe();
}

async function testMoveEmptyDirectories() {
  const fs = createVFS('MoveEmptyTest');

  // 创建空目录
  await fs.makeDirectory('/empty1');
  await fs.makeDirectory('/empty2');
  await fs.makeDirectory('/parent');

  // 移动空目录
  await fs.move('/empty1', '/moved_empty');
  assert(await fs.exists('/moved_empty'), '空目录应该移动成功');
  assert(!(await fs.exists('/empty1')), '原空目录应该不存在');

  const movedStat = await fs.stat('/moved_empty');
  assert(movedStat.isDirectory, '移动后应该仍是目录');

  // 移动空目录到另一个目录中
  await fs.move('/empty2', '/parent/empty2');
  assert(await fs.exists('/parent/empty2'), '空目录应该移动到父目录');
  assert(!(await fs.exists('/empty2')), '原空目录应该不存在');

  // 验证目录列表
  const parentContents = await fs.readDirectory('/parent');
  assertEqual(parentContents.length, 1, '父目录应该包含一个子目录');
  assertEqual(parentContents[0].name, 'empty2', '子目录名称应该正确');

  console.log('   - 空目录移动: 正常');
  console.log('   - 空目录到子目录: 正常');

  await fs.wipe();
}

async function testMoveNestedDirectories() {
  const fs = createVFS('MoveNestedTest');

  // 创建深层嵌套目录结构
  const depth = 10;
  let currentPath = '/deep';

  for (let i = 0; i < depth; i++) {
    currentPath += `/level${i}`;
    await fs.makeDirectory(currentPath, true);
  }

  // 在最深层创建文件
  await fs.writeFile(`${currentPath}/deep_file.txt`, 'deep content');

  // 移动整个深层结构
  await fs.move('/deep', '/moved_deep');

  // 验证深层结构完整性
  assert(await fs.exists('/moved_deep'), '根目录应该移动成功');
  assert(!(await fs.exists('/deep')), '原根目录应该不存在');

  // 验证每一层都存在
  let checkPath = '/moved_deep';
  for (let i = 0; i < depth; i++) {
    checkPath += `/level${i}`;
    assert(await fs.exists(checkPath), `层级 ${i} 应该存在`);
  }

  // 验证最深层文件
  const deepFile = `${checkPath}/deep_file.txt`;
  assert(await fs.exists(deepFile), '最深层文件应该存在');

  const content = await fs.readFile(deepFile, { encoding: 'utf8' });
  assertEqual(content, 'deep content', '最深层文件内容应该正确');

  console.log('   - 深层嵌套移动: 正常');
  console.log('   - 结构完整性: 正常');
  console.log(`   - ${depth}层深度处理: 正常`);

  await fs.wipe();
}

async function testMoveSpecialCharacters() {
  const fs = createVFS('MoveSpecialTest');

  // 创建包含特殊字符的文件和目录
  const specialNames = [
    'file with spaces.txt',
    'file-with-dashes.txt',
    'file_with_underscores.txt',
    'file.with.dots.txt',
    '中文文件.txt',
    'файл.txt',
    'ファイル.txt'
  ];

  for (const name of specialNames) {
    await fs.writeFile(`/${name}`, `content of ${name}`);
  }

  // 移动特殊字符文件
  for (let i = 0; i < specialNames.length; i++) {
    const oldName = specialNames[i];
    const newName = `moved_${i}_${oldName}`;

    await fs.move(`/${oldName}`, `/${newName}`);

    assert(await fs.exists(`/${newName}`), `移动后的文件 ${newName} 应该存在`);
    assert(!(await fs.exists(`/${oldName}`)), `原文件 ${oldName} 应该不存在`);

    const content = await fs.readFile(`/${newName}`, { encoding: 'utf8' });
    assertEqual(content, `content of ${oldName}`, `文件 ${newName} 内容应该正确`);
  }

  // 创建包含特殊字符的目录
  await fs.makeDirectory('/special dir with spaces');
  await fs.writeFile('/special dir with spaces/nested file.txt', 'nested content');

  await fs.move('/special dir with spaces', '/moved special dir');

  assert(await fs.exists('/moved special dir'), '特殊字符目录应该移动成功');
  assert(await fs.exists('/moved special dir/nested file.txt'), '嵌套文件应该还在');

  console.log('   - 空格文件名: 正常');
  console.log('   - 特殊符号: 正常');
  console.log('   - 多语言字符: 正常');
  console.log('   - 特殊字符目录: 正常');

  await fs.wipe();
}

/*
async function testMoveConcurrentOperations() {
  const fs = createVFS('MoveConcurrentTest');

  // 创建多个文件进行并发移动测试
  const fileCount = 4;
  const createPromises = [];

  for (let i = 0; i < fileCount; i++) {
    createPromises.push(fs.writeFile(`/file${i}.txt`, `content ${i}`));
  }

  await Promise.all(createPromises);

  // 并发移动所有文件
  const movePromises = [];
  for (let i = 0; i < fileCount; i++) {
    movePromises.push(fs.move(`/file${i}.txt`, `/moved${i}.txt`));
  }

  await Promise.all(movePromises);

  // 验证所有文件都移动成功
  for (let i = 0; i < fileCount; i++) {
    assert(await fs.exists(`/moved${i}.txt`), `文件 moved${i}.txt 应该存在`);
    assert(!(await fs.exists(`/file${i}.txt`)), `原文件 file${i}.txt 应该不存在`);

    const content = await fs.readFile(`/moved${i}.txt`, { encoding: 'utf8' });
    assertEqual(content, `content ${i}`, `文件 moved${i}.txt 内容应该正确`);
  }

  console.log(`   - ${fileCount}个文件并发移动: 正常`);
  console.log('   - 数据完整性: 正常');

  await fs.wipe();
}
*/

async function testMoveWithCWD() {
  const fs = createVFS('MoveCWDTest');

  // 创建测试目录结构
  await fs.makeDirectory('/project/src/components', true);
  await fs.makeDirectory('/project/build', true);
  await fs.makeDirectory('/project/docs', true);
  await fs.writeFile('/project/src/main.js', 'main code');
  await fs.writeFile('/project/src/utils.js', 'utils code');
  await fs.writeFile('/project/src/components/Button.js', 'button component');
  await fs.writeFile('/project/README.md', 'readme');

  // 测试从根目录移动
  assertEqual(fs.getCwd(), '/', '初始CWD应该是根目录');

  // 使用相对路径移动文件
  await fs.move('project/README.md', 'project/docs/README.md');
  assert(await fs.exists('/project/docs/README.md'), '文件应该移动到docs目录');
  assert(!(await fs.exists('/project/README.md')), '原文件应该不存在');

  // 切换到project目录
  await fs.chdir('/project');
  assertEqual(fs.getCwd(), '/project', 'CWD应该切换到project');

  // 在project目录下移动文件
  await fs.move('src/main.js', 'build/main.js');
  assert(await fs.exists('/project/build/main.js'), '文件应该移动到build目录');
  assert(!(await fs.exists('/project/src/main.js')), '原文件应该不存在');

  // 使用相对路径移动到上级目录
  await fs.move('src/utils.js', '../utils.js');
  assert(await fs.exists('/utils.js'), '文件应该移动到根目录');
  assert(!(await fs.exists('/project/src/utils.js')), '原文件应该不存在');

  // 切换到src目录
  await fs.chdir('src');
  assertEqual(fs.getCwd(), '/project/src', 'CWD应该切换到src');

  // 从当前目录移动文件
  await fs.move('components/Button.js', '../build/Button.js');
  assert(await fs.exists('/project/build/Button.js'), '组件文件应该移动到build目录');
  assert(!(await fs.exists('/project/src/components/Button.js')), '原文件应该不存在');

  console.log('   - 根目录相对路径移动: 正常');
  console.log('   - CWD切换后移动: 正常');
  console.log('   - 上级目录移动: 正常');
  console.log('   - 当前目录相对移动: 正常');

  await fs.wipe();
}

async function testMoveWithDotPaths() {
  const fs = createVFS('MoveDotPathTest');

  // 创建测试结构
  await fs.makeDirectory('/workspace/project/src', true);
  await fs.makeDirectory('/workspace/project/test', true);
  await fs.makeDirectory('/workspace/backup', true);
  await fs.writeFile('/workspace/project/src/app.js', 'app');
  await fs.writeFile('/workspace/project/test/app.test.js', 'test');
  await fs.writeFile('/workspace/project/config.json', 'config');

  // 切换到project目录
  await fs.chdir('/workspace/project');

  // 使用 . 移动到当前目录的子目录
  await fs.move('./config.json', './src/config.json');
  assert(await fs.exists('/workspace/project/src/config.json'), '文件应该移动到src目录');
  assert(!(await fs.exists('/workspace/project/config.json')), '原文件应该不存在');

  // 使用 .. 移动到父目录
  await fs.move('src/app.js', '../backup/app.js');
  assert(await fs.exists('/workspace/backup/app.js'), '文件应该移动到backup目录');
  assert(!(await fs.exists('/workspace/project/src/app.js')), '原文件应该不存在');

  // 使用 ../../ 移动到更上级目录
  await fs.chdir('/workspace/project/test');
  await fs.move('app.test.js', '../../app.test.js');
  assert(await fs.exists('/workspace/app.test.js'), '文件应该移动到workspace目录');
  assert(!(await fs.exists('/workspace/project/test/app.test.js')), '原文件应该不存在');

  // 混合使用绝对路径和相对路径
  await fs.move('/workspace/backup/app.js', './restored_app.js');
  assert(await fs.exists('/workspace/project/test/restored_app.js'), '文件应该移动到当前test目录');
  assert(!(await fs.exists('/workspace/backup/app.js')), '原文件应该不存在');

  console.log('   - . 路径移动: 正常');
  console.log('   - .. 路径移动: 正常');
  console.log('   - ../../ 路径移动: 正常');
  console.log('   - 混合路径移动: 正常');

  await fs.wipe();
}

async function testMoveDirectoryWithCWD() {
  const fs = createVFS('MoveDirCWDTest');

  // 创建测试目录结构
  await fs.makeDirectory('/home/user/projects/app/src', true);
  await fs.makeDirectory('/home/user/projects/app/assets', true);
  await fs.makeDirectory('/home/user/backup', true);
  await fs.writeFile('/home/user/projects/app/src/main.js', 'main');
  await fs.writeFile('/home/user/projects/app/assets/logo.png', 'logo');

  // 切换到projects目录
  await fs.chdir('/home/user/projects');

  // 移动整个app目录到backup
  await fs.move('app', '../backup/app');
  assert(await fs.exists('/home/user/backup/app'), 'app目录应该移动到backup');
  assert(await fs.exists('/home/user/backup/app/src/main.js'), '源码文件应该还在');
  assert(await fs.exists('/home/user/backup/app/assets/logo.png'), '资源文件应该还在');
  assert(!(await fs.exists('/home/user/projects/app')), '原app目录应该不存在');

  // 切换到backup目录
  await fs.chdir('/home/user/backup');

  // 重命名目录
  await fs.move('app', 'old_app');
  assert(await fs.exists('/home/user/backup/old_app'), '目录应该重命名成功');
  assert(await fs.exists('/home/user/backup/old_app/src/main.js'), '内部文件应该还在');
  assert(!(await fs.exists('/home/user/backup/app')), '原目录名应该不存在');

  // 移动目录到子目录
  await fs.makeDirectory('archive');
  await fs.move('./old_app', './archive/old_app');
  assert(await fs.exists('/home/user/backup/archive/old_app'), '目录应该移动到archive');
  assert(!(await fs.exists('/home/user/backup/old_app')), '原目录应该不存在');

  console.log('   - CWD相对目录移动: 正常');
  console.log('   - CWD目录重命名: 正常');
  console.log('   - CWD子目录移动: 正常');

  await fs.wipe();
}

async function testMoveWithPushdPopd() {
  const fs = createVFS('MovePushdPopdTest');

  // 创建测试结构
  await fs.makeDirectory('/workspace/src', true);
  await fs.makeDirectory('/workspace/build', true);
  await fs.makeDirectory('/tmp', true);
  await fs.writeFile('/workspace/src/file1.js', 'file1');
  await fs.writeFile('/workspace/src/file2.js', 'file2');
  await fs.writeFile('/tmp/temp.txt', 'temp');

  // 初始在根目录
  assertEqual(fs.getCwd(), '/', '初始在根目录');

  // pushd到workspace并移动文件
  await fs.pushd('/workspace');
  assertEqual(fs.getCwd(), '/workspace', '应该切换到workspace');

  await fs.move('src/file1.js', 'build/file1.js');
  assert(await fs.exists('/workspace/build/file1.js'), '文件应该移动成功');

  // pushd到tmp并移动文件
  await fs.pushd('/tmp');
  assertEqual(fs.getCwd(), '/tmp', '应该切换到tmp');

  await fs.move('temp.txt', '../workspace/build/temp.txt');
  assert(await fs.exists('/workspace/build/temp.txt'), '文件应该移动到build');
  assert(!(await fs.exists('/tmp/temp.txt')), '原文件应该不存在');

  // popd回到workspace
  await fs.popd();
  assertEqual(fs.getCwd(), '/workspace', '应该回到workspace');

  await fs.move('src/file2.js', 'build/file2.js');
  assert(await fs.exists('/workspace/build/file2.js'), '文件应该移动成功');

  // popd回到根目录
  await fs.popd();
  assertEqual(fs.getCwd(), '/', '应该回到根目录');

  console.log('   - pushd后移动: 正常');
  console.log('   - 目录栈状态: 正常');
  console.log('   - popd后移动: 正常');

  await fs.wipe();
}

async function testMoveCWDValidation() {
  const fs = createVFS('MoveCWDValidationTest');

  // 创建测试结构
  await fs.makeDirectory('/project/src', true);
  await fs.writeFile('/project/src/main.js', 'main');
  await fs.writeFile('/project/config.json', 'config');

  // 切换到project目录
  await fs.chdir('/project');

  // 测试移动当前工作目录应该失败
  try {
    await fs.move('.', '../moved_project');
    throw new Error('应该抛出错误');
  } catch (error) {
    assert(error instanceof VFSError, '移动当前目录应该抛出VFSError');
    assertEqual(error['code'], 'EBUSY', '错误代码应该是EBUSY');
  }

  // 测试移动CWD的父目录也应该失败
  await fs.chdir('/project/src');
  try {
    await fs.move('/project', '/moved_project');
    throw new Error('应该抛出错误');
  } catch (error) {
    assert(error instanceof VFSError, '移动CWD父目录应该抛出VFSError');
    assertEqual(error['code'], 'EBUSY', '错误代码应该是EBUSY');
  }

  // 但可以移动CWD中的文件
  await fs.chdir('/project');
  await fs.move('config.json', 'src/config.json');
  assert(await fs.exists('/project/src/config.json'), '移动CWD中的文件应该成功');

  // 可以移动到CWD的兄弟目录
  await fs.chdir('/project/src');
  await fs.makeDirectory('/project/build');
  await fs.move('main.js', '../build/main.js');
  assert(await fs.exists('/project/build/main.js'), '移动到兄弟目录应该成功');

  // 可以移动不相关的目录
  await fs.makeDirectory('/other');
  await fs.makeDirectory('/another');
  await fs.move('/other', '/moved_other');
  assert(await fs.exists('/moved_other'), '移动不相关目录应该成功');

  console.log('   - CWD移动限制: 正常');
  console.log('   - CWD父目录移动限制: 正常');
  console.log('   - CWD内文件移动: 正常');
  console.log('   - 兄弟目录移动: 正常');
  console.log('   - 不相关目录移动: 正常');

  await fs.wipe();
}

async function testMoveComplexRelativePaths() {
  const fs = createVFS('MoveComplexRelativeTest');

  // 创建复杂的目录结构
  await fs.makeDirectory('/deep/nested/structure/with/many/levels', true);
  await fs.makeDirectory('/another/path/here', true);
  await fs.makeDirectory('/target/destination', true);

  await fs.writeFile('/deep/nested/structure/file1.txt', 'file1');
  await fs.writeFile('/deep/nested/structure/with/file2.txt', 'file2');
  await fs.writeFile('/deep/nested/structure/with/many/file3.txt', 'file3');
  await fs.writeFile('/another/path/file4.txt', 'file4');

  // 切换到深层目录
  await fs.chdir('/deep/nested/structure/with/many');

  // 使用复杂的相对路径移动文件
  await fs.move('file3.txt', '../../../file3_moved.txt');
  assert(await fs.exists('/deep/nested/file3_moved.txt'), '复杂相对路径移动应该成功');
  assert(!(await fs.exists('/deep/nested/structure/with/many/file3.txt')), '原文件应该不存在');

  // 移动到完全不同的路径
  await fs.move('../../file1.txt', '../../../../../target/destination/file1.txt');
  assert(await fs.exists('/target/destination/file1.txt'), '跨路径移动应该成功');
  assert(!(await fs.exists('/deep/nested/structure/file1.txt')), '原文件应该不存在');

  // 切换到另一个路径
  await fs.chdir('/another/path');

  // 使用混合路径（绝对路径源，相对路径目标）
  await fs.move('/deep/nested/structure/with/file2.txt', './file2_moved.txt');
  assert(await fs.exists('/another/path/file2_moved.txt'), '混合路径移动应该成功');
  assert(!(await fs.exists('/deep/nested/structure/with/file2.txt')), '原文件应该不存在');

  // 使用相对路径源，绝对路径目标
  await fs.move('file4.txt', '/target/destination/file4.txt');
  assert(await fs.exists('/target/destination/file4.txt'), '相对到绝对路径移动应该成功');
  assert(!(await fs.exists('/another/path/file4.txt')), '原文件应该不存在');

  // 测试更复杂的相对路径组合
  await fs.chdir('/target');
  await fs.writeFile('/target/temp.txt', 'temp');

  // 移动到当前目录的子目录
  await fs.move('./temp.txt', './destination/temp.txt');
  assert(await fs.exists('/target/destination/temp.txt'), '当前目录移动应该成功');
  assert(!(await fs.exists('/target/temp.txt')), '原文件应该不存在');

  // 测试包含 . 和 .. 的复杂路径
  await fs.chdir('/deep/nested');
  await fs.writeFile('/deep/nested/test.txt', 'test');

  await fs.move('./test.txt', './../test_moved.txt');
  assert(await fs.exists('/deep/test_moved.txt'), '. 和 .. 组合路径应该成功');
  assert(!(await fs.exists('/deep/nested/test.txt')), '原文件应该不存在');

  // 测试多重 ../ 路径
  await fs.chdir('/deep/nested/structure/with/many/levels');
  await fs.writeFile('/deep/nested/structure/with/many/levels/deep_file.txt', 'deep');

  await fs.move('deep_file.txt', '../../../../../moved_deep.txt');
  assert(await fs.exists('/deep/moved_deep.txt'), '多重..路径应该成功');
  assert(!(await fs.exists('/deep/nested/structure/with/many/levels/deep_file.txt')), '原文件应该不存在');

  console.log('   - 复杂相对路径: 正常');
  console.log('   - 跨路径移动: 正常');
  console.log('   - 混合路径类型: 正常');
  console.log('   - . 和 .. 组合: 正常');
  console.log('   - 多重..路径: 正常');

  await fs.wipe();
}

async function testMoveCWDPathNormalization() {
  const fs = createVFS('MoveCWDNormalizationTest');

  // 创建测试结构
  await fs.makeDirectory('/project/src/components', true);
  await fs.writeFile('/project/src/app.js', 'app');
  await fs.writeFile('/project/src/components/Button.js', 'button');

  // 切换到src目录
  await fs.chdir('/project/src');

  // 测试路径规范化：重复的斜杠
  await fs.move('./app.js', './/renamed_app.js');
  assert(await fs.exists('/project/src/renamed_app.js'), '重复斜杠路径应该正常处理');
  assert(!(await fs.exists('/project/src/app.js')), '原文件应该不存在');

  // 测试路径规范化：多余的 ./
  await fs.move('./components/Button.js', './././moved_button.js');
  assert(await fs.exists('/project/src/moved_button.js'), '多余的./应该正常处理');
  assert(!(await fs.exists('/project/src/components/Button.js')), '原文件应该不存在');

  // 测试路径规范化：. 和 .. 混合
  await fs.writeFile('/project/src/test.js', 'test');
  await fs.move('./test.js', './../src/../src/normalized_test.js');
  assert(await fs.exists('/project/src/normalized_test.js'), '复杂路径规范化应该成功');
  assert(!(await fs.exists('/project/src/test.js')), '原文件应该不存在');

  // 测试目录移动的路径规范化
  await fs.chdir('/project');
  await fs.makeDirectory('/project/temp');
  await fs.writeFile('/project/temp/temp_file.js', 'temp');

  await fs.move('./temp/../temp', './src/../normalized_temp');
  assert(await fs.exists('/project/normalized_temp'), '目录路径规范化应该成功');
  assert(await fs.exists('/project/normalized_temp/temp_file.js'), '目录内文件应该保持');
  assert(!(await fs.exists('/project/temp')), '原目录应该不存在');

  console.log('   - 重复斜杠处理: 正常');
  console.log('   - 多余./处理: 正常');
  console.log('   - 复杂路径规范化: 正常');
  console.log('   - 目录路径规范化: 正常');

  await fs.wipe();
}

async function testFSEncoding() {
  const fs = createVFS('FSEncodingTest');

  // 测试1：UTF-8写入，不同方式读取
  await fs.writeFile('/test1.txt', 'Hello 世界!', { encoding: 'utf8' });

  const asString = await fs.readFile('/test1.txt', { encoding: 'utf8' });
  const asBinary = await fs.readFile('/test1.txt', { encoding: 'binary' });
  const asBase64 = await fs.readFile('/test1.txt', { encoding: 'base64' });

  console.log('UTF-8 write test:');
  console.log('- String:', asString);
  console.log('- Binary length:', (asBinary as ArrayBuffer).byteLength);
  console.log('- Base64:', asBase64);

  // 测试2：二进制写入，不同方式读取
  const binaryData = new TextEncoder().encode('Binary test 二进制').buffer;
  await fs.writeFile('/test2.bin', binaryData, { encoding: 'binary' });

  const binaryAsString = await fs.readFile('/test2.bin', { encoding: 'utf8' });
  const binaryAsBinary = await fs.readFile('/test2.bin', { encoding: 'binary' });

  console.log('\nBinary write test:');
  console.log('- As string:', binaryAsString);
  console.log('- As binary length:', (binaryAsBinary as ArrayBuffer).byteLength);

  // 测试3：Base64写入
  const base64Data = btoa('Base64 test');
  await fs.writeFile('/test3.b64', base64Data, { encoding: 'base64' });

  const b64AsString = await fs.readFile('/test3.b64', { encoding: 'utf8' });
  console.log('\nBase64 write test:');
  console.log('- Decoded:', b64AsString);

  await fs.wipe();
}

// 主测试函数
export async function runAllVFSTests() {
  const testsWithZipFS = [
    ['基础文件操作', testBasicFileOperations],
    ['目录操作', testDirectoryOperations],
    ['挂载操作', testMountOperations],
    ['文件复制', testFileCopy],
    ['错误处理', testErrorHandling],
    ['二进制数据', testBinaryData],
    ['二进制数据追加', testBinaryDataAppend],
    ['挂载优先级', testMountPriority],
    ['跨挂载操作', testCrossMountOperations],
    ['文件选项处理', testFileOptions],
    ['文件状态查询', testStatOperations],
    ['大型文件操作', testLargeFileOperations],
    ['glob基础测试', testGlobBasicWildcards],
    ['glob复杂测试', testGlobComplexPatterns],
    ['glob边缘测试', testGlobEdgeCases],
    ['glob忽略测试', testGlobIgnorePatterns],
    ['glob多重查找测试', testGlobMultiplePatterns],
    ['glob性能测试', testGlobPerformance],
    ['glob选项测试', testGlobOptions],
    ['glob递归查找测试', testGlobRecursiveSearch],
    ['CWD基础操作', testCwdBasicOperations],
    ['CWD相对路径解析', testCwdRelativePathResolution],
    ['CWD目录栈操作', testCwdDirectoryStack],
    ['CWD相对pushd', testCwdWithRelativePushd],
    ['CWD路径工具', testCwdJoinAndRelative],
    ['CWD错误处理', testCwdErrorHandling],
    ['CWD挂载点支持', testCwdWithMounts],
    ['CWD Glob支持', testCwdGlobWithRelativePaths],
    ['CWD复杂场景', testCwdComplexScenarios],
    ['CWD边缘情况', testCwdEdgeCases],
    ['CWD性能测试', testCwdPerformance],
    ['编码转换测试', testFSEncoding],
    ['Move基础操作', testMoveBasicOperations],
    ['Move到目录', testMoveToDirectory],
    ['Move复杂目录', testMoveComplexDirectory],
    ['Move覆盖操作', testMoveOverwrite],
    ['Move错误处理', testMoveErrorHandling],
    ['Move跨VFS限制', testMoveCrossVFSRestriction],
    ['Move相对路径', testMoveWithRelativePaths],
    ['Move元数据保持', testMovePreservesMetadata],
    ['Move大文件', testMoveLargeFiles],
    ['Move二进制文件', testMoveBinaryFiles],
    ['Move空目录', testMoveEmptyDirectories],
    ['Move嵌套目录', testMoveNestedDirectories],
    ['Move特殊字符', testMoveSpecialCharacters],
    //['Move并发操作', testMoveConcurrentOperations],
    ['Move与CWD', testMoveWithCWD],
    ['Move点路径', testMoveWithDotPaths],
    ['Move目录与CWD', testMoveDirectoryWithCWD],
    ['Move与目录栈', testMoveWithPushdPopd],
    ['Move CWD验证', testMoveCWDValidation],
    ['Move复杂相对路径', testMoveComplexRelativePaths],
    ['Move路径规范化', testMoveCWDPathNormalization]
  ] as const;

  for (currentTest = 0; currentTest < 3; currentTest++) {
    console.log(`--------------- 🚀 开始 ${VFSTypes[currentTest]} 文件系统测试 ---------------\n`);
    let passed = 0;
    const total = testsWithZipFS.length;

    for (const [name, testFn] of testsWithZipFS) {
      const success = await runTest(name, testFn);
      if (success) {
        passed++;
      }
      console.log(); // 空行分隔
    }

    console.log(`📊 测试完成: ${passed}/${total} 通过`);
    if (passed === total) {
      console.log('🎉 所有测试都通过了！');
    } else {
      console.log('⚠️  有测试失败，请检查上面的错误信息');
    }
  }
}

async function testGlobBasicWildcards() {
  const fs = createVFS('GlobTest');
  await createGlobTestStructure(fs);

  const a = await fs.glob('/src/**/*', {
    includeDirs: false,
    includeFiles: true,
    recursive: true,
    includeHidden: true
  });
  assertEqual(a.length, 9, '** 通配符应该工作');
  // 测试 * 通配符
  const txtFiles = await fs.glob('*.txt');
  const txtNames = txtFiles.map((r) => r.name).sort();
  assertArrayEqual(txtNames, ['file1.txt'], '* 通配符应该匹配 .txt 文件');

  // 测试 ? 通配符
  const questionFiles = await fs.glob('file?.txt');
  const questionNames = questionFiles.map((r) => r.name).sort();
  assertArrayEqual(questionNames, ['file1.txt'], '? 通配符应该匹配单个字符');

  // 测试花括号展开
  const jstsFiles = await fs.glob('*.{js,ts}');
  const jstsNames = jstsFiles.map((r) => r.name).sort();
  assertArrayEqual(jstsNames, ['app.js', 'test.min.js'], '花括号展开应该匹配多个扩展名');

  // 测试字符类
  const numberFiles = await fs.glob('file[1-9].txt');
  const numberNames = numberFiles.map((r) => r.name).sort();
  assertArrayEqual(numberNames, ['file1.txt'], '字符类应该匹配数字范围');

  console.log('   - * 通配符: 正常');
  console.log('   - ? 通配符: 正常');
  console.log('   - 花括号展开: 正常');
  console.log('   - 字符类匹配: 正常');

  await fs.wipe();
}

async function testGlobRecursiveSearch() {
  const fs = createVFS('GlobRecursive');
  await createGlobTestStructure(fs);

  // 测试递归匹配所有 JS 文件
  const allJsFiles = await fs.glob('**/*.js');
  const allJsPaths = allJsFiles.map((r) => r.relativePath).sort();

  assert(allJsPaths.length >= 5, '应该找到多个 JS 文件');
  assertContains(allJsPaths, 'src/index.js', '应该找到 src/index.js');
  assertContains(allJsPaths, 'src/components/index.js', '应该找到组件索引文件');
  assertContains(allJsPaths, 'tests/unit.test.js', '应该找到测试文件');

  // 测试特定目录下的文件
  const srcFiles = await fs.glob('src/**/*.{js,ts,jsx,tsx}');
  const srcPaths = srcFiles.map((r) => r.relativePath).sort();

  assert(
    srcPaths.every((p) => p.startsWith('src/')),
    '所有结果都应该在 src 目录下'
  );
  assertContains(srcPaths, 'src/utils.ts', '应该找到 TypeScript 文件');
  assertContains(srcPaths, 'src/App.jsx', '应该找到 JSX 文件');
  assertContains(srcPaths, 'src/components/Button.tsx', '应该找到 TSX 文件');

  // 测试多级深度匹配
  const imageFiles = await fs.glob('**/images/*');
  const imagePaths = imageFiles.map((r) => r.relativePath).sort();
  assertArrayEqual(imagePaths, ['docs/images/logo.png', 'docs/images/screenshot.jpg'], '应该找到图片文件');

  console.log('   - 递归 JS 文件搜索: 正常');
  console.log('   - 特定目录搜索: 正常');
  console.log('   - 多级深度搜索: 正常');

  await fs.wipe();
}

async function testGlobOptions() {
  const fs = createVFS('GlobOptions');
  await createGlobTestStructure(fs);

  // 测试大小写不敏感
  const caseInsensitive = await fs.glob('*.TXT', { caseSensitive: false });
  const caseInsensitiveNames = caseInsensitive.map((r) => r.name).sort();
  assertArrayEqual(caseInsensitiveNames, ['File3.TXT', 'file1.txt'], '大小写不敏感应该匹配所有文件');

  // 测试大小写敏感（默认）
  const caseSensitive = await fs.glob('*.TXT', { caseSensitive: true });
  const caseSensitiveNames = caseSensitive.map((r) => r.name).sort();
  assertArrayEqual(caseSensitiveNames, ['File3.TXT'], '大小写敏感应该只匹配确切大小写');

  // 测试包含隐藏文件
  const hiddenFiles = await fs.glob('.*', { includeHidden: true });
  const hiddenNames = hiddenFiles.map((r) => r.name).sort();
  assertContains(hiddenNames, '.hidden', '应该包含隐藏文件');

  // 测试排除隐藏文件（默认）
  const noHiddenFiles = await fs.glob('.*', { includeHidden: false });
  assertEqual(noHiddenFiles.length, 0, '默认应该排除隐藏文件');

  // 测试只包含文件
  const onlyFiles = await fs.glob('src/*', { includeFiles: true, includeDirs: false });
  const fileTypes = [...new Set(onlyFiles.map((r) => r.type))];
  assertArrayEqual(fileTypes, ['file'], '应该只包含文件');

  // 测试只包含目录
  const onlyDirs = await fs.glob('*', { includeFiles: false, includeDirs: true });
  const dirTypes = [...new Set(onlyDirs.map((r) => r.type))];
  assertArrayEqual(dirTypes, ['directory'], '应该只包含目录');

  // 测试限制结果数量
  const limitedResults = await fs.glob('**/*', { limit: 5 });
  assertEqual(limitedResults.length, 5, '应该限制结果数量');

  // 测试自定义工作目录
  const cwdResults = await fs.glob('*.js', { cwd: '/src' });
  const cwdNames = cwdResults.map((r) => r.name).sort();
  assertArrayEqual(cwdNames, ['index.js'], '自定义工作目录应该正确工作');

  // 测试非递归搜索
  const nonRecursive = await fs.glob('*', { recursive: false });
  const nonRecursivePaths = nonRecursive.map((r) => r.relativePath);
  assert(
    nonRecursivePaths.every((p) => !p.includes('/')),
    '非递归搜索应该只返回根目录项'
  );

  console.log('   - 大小写敏感控制: 正常');
  console.log('   - 隐藏文件控制: 正常');
  console.log('   - 文件类型过滤: 正常');
  console.log('   - 结果数量限制: 正常');
  console.log('   - 工作目录控制: 正常');
  console.log('   - 递归控制: 正常');

  await fs.wipe();
}

async function testGlobIgnorePatterns() {
  const fs = createVFS('GlobIgnore');
  await createGlobTestStructure(fs);

  // 测试忽略单个模式
  const withoutMin = await fs.glob('**/*.js', { ignore: '**/*.min.js' });
  const withoutMinNames = withoutMin.map((r) => r.name);
  assertNotContains(withoutMinNames, 'test.min.js', '应该忽略 .min.js 文件');

  // 测试忽略多个模式
  const withMultipleIgnores = await fs.glob('**/*', {
    ignore: ['**/*.min.*', '**/node_modules/**', '**/.DS_Store']
  });
  const ignoredPaths = withMultipleIgnores.map((r) => r.relativePath);

  assertNotContains(ignoredPaths, 'test.min.js', '应该忽略 minified 文件');
  assertNotContains(ignoredPaths, 'node_modules/package/index.js', '应该忽略 node_modules');
  assertNotContains(ignoredPaths, 'src/components/.DS_Store', '应该忽略系统文件');

  console.log('   - 单个忽略模式: 正常');
  console.log('   - 多个忽略模式: 正常');

  await fs.wipe();
}

async function testGlobMultiplePatterns() {
  const fs = createVFS('GlobMultiple');
  await createGlobTestStructure(fs);

  // 测试多个模式匹配
  const multiResults = await fs.glob(['*.md', '*.json']);
  const multiNames = multiResults.map((r) => r.name).sort();
  assertArrayEqual(multiNames, ['package.json', 'readme.md'], '应该匹配多个模式');

  // 测试匹配模式标记
  for (const result of multiResults) {
    if (result.name.endsWith('.md')) {
      assertEqual(result.matchedPattern, '*.md', 'Markdown 文件应该标记正确的匹配模式');
    } else if (result.name.endsWith('.json')) {
      assertEqual(result.matchedPattern, '*.json', 'JSON 文件应该标记正确的匹配模式');
    }
  }

  console.log('   - 多模式匹配: 正常');
  console.log('   - 匹配模式标记: 正常');

  await fs.wipe();
}

async function testGlobComplexPatterns() {
  const fs = createVFS('GlobComplex');
  await createGlobTestStructure(fs);

  // 测试匹配测试文件
  const testFiles = await fs.glob('**/*.test.{js,ts}');
  const testNames = testFiles.map((r) => r.name).sort();
  assertArrayEqual(testNames, ['integration.test.ts', 'unit.test.js'], '应该匹配测试文件');

  // 测试排除测试文件
  const withoutTests = await fs.glob('**/*.{js,ts}', { ignore: '**/*.test.*' });
  const withoutTestNames = withoutTests.map((r) => r.name);
  assertNotContains(withoutTestNames, 'unit.test.js', '应该排除 JS 测试文件');
  assertNotContains(withoutTestNames, 'integration.test.ts', '应该排除 TS 测试文件');

  // 测试匹配组件文件
  const componentFiles = await fs.glob('**/components/*.{jsx,tsx}');
  const componentNames = componentFiles.map((r) => r.name).sort();
  assertArrayEqual(componentNames, ['Button.tsx', 'Modal.jsx'], '应该匹配组件文件');

  console.log('   - 测试文件匹配: 正常');
  console.log('   - 测试文件排除: 正常');
  console.log('   - 组件文件匹配: 正常');

  await fs.wipe();
}

async function testGlobEdgeCases() {
  const fs = createVFS('GlobEdge');
  await createGlobTestStructure(fs);

  // 测试空模式
  const emptyResults = await fs.glob('');
  assertEqual(emptyResults.length, 0, '空模式应该返回空结果');

  // 测试不匹配的模式
  const noMatchResults = await fs.glob('*.nonexistent');
  assertEqual(noMatchResults.length, 0, '不匹配的模式应该返回空结果');

  console.log('   - 空模式处理: 正常');
  console.log('   - 无匹配处理: 正常');

  await fs.wipe();
}

async function testGlobPerformance() {
  const fs = createVFS('GlobPerf');

  // 创建大量文件进行性能测试
  console.log('   - 创建 100 个测试文件...');
  for (let i = 0; i < 100; i++) {
    await fs.writeFile(`/perf${i}.txt`, `content${i}`);
  }

  const start = Date.now();
  const perfResults = await fs.glob('perf*.txt');
  const duration = Date.now() - start;

  assertEqual(perfResults.length, 100, '性能测试应该找到所有文件');
  assert(duration < 1000, `性能测试应该在合理时间内完成 (${duration}ms)`);

  // 测试限制功能提升性能
  const limitedResults = await fs.glob('**/*', { limit: 10 });
  assert(limitedResults.length <= 10, '限制功能应该正确工作');

  console.log(`   - 大量文件处理: 正常 (${duration}ms)`);
  console.log('   - 限制功能: 正常');

  await fs.wipe();
}

// 在现有测试函数之后添加以下新的测试函数

async function testCwdBasicOperations() {
  const fs = createVFS('CwdTest');

  // 测试默认 CWD
  assertEqual(fs.getCwd(), '/', '默认 CWD 应该是根目录');

  // 创建目录结构
  await fs.makeDirectory('/home/user/documents', true);
  await fs.makeDirectory('/tmp');
  await fs.writeFile('/home/user/test.txt', 'test content');

  // 测试 chdir
  await fs.chdir('/home/user');
  assertEqual(fs.getCwd(), '/home/user', 'chdir 应该改变当前目录');

  // 测试相对路径操作
  const content = await fs.readFile('test.txt', { encoding: 'utf8' });
  assertEqual(content, 'test content', '应该能用相对路径读取文件');

  // 测试相对路径写入
  await fs.writeFile('new-file.txt', 'new content');
  assert(await fs.exists('/home/user/new-file.txt'), '相对路径写入的文件应该存在');

  console.log('   - 默认 CWD: 正常');
  console.log('   - chdir 操作: 正常');
  console.log('   - 相对路径操作: 正常');

  await fs.wipe();
}

async function testCwdRelativePathResolution() {
  const fs = createVFS('RelativePathTest');

  // 创建复杂的目录结构
  await fs.makeDirectory('/a/b/c/d', true);
  await fs.makeDirectory('/a/x/y', true);
  await fs.writeFile('/a/b/test.txt', 'test');
  await fs.writeFile('/a/x/other.txt', 'other');

  // 设置工作目录
  await fs.chdir('/a/b/c');

  // 测试 . 路径
  assertEqual(fs.normalizePath('.'), '/a/b/c', '. 应该表示当前目录');

  // 测试 .. 路径
  assertEqual(fs.normalizePath('..'), '/a/b', '.. 应该表示父目录');
  assertEqual(fs.normalizePath('../..'), '/a', '../.. 应该表示祖父目录');

  // 测试复杂的相对路径
  assertEqual(fs.normalizePath('../test.txt'), '/a/b/test.txt', '相对路径应该正确解析');
  assertEqual(fs.normalizePath('../../x/other.txt'), '/a/x/other.txt', '复杂相对路径应该正确解析');

  // 测试相对路径文件操作
  const testContent = await fs.readFile('../test.txt', { encoding: 'utf8' });
  assertEqual(testContent, 'test', '应该能通过相对路径读取文件');

  const otherContent = await fs.readFile('../../x/other.txt', { encoding: 'utf8' });
  assertEqual(otherContent, 'other', '应该能通过复杂相对路径读取文件');

  console.log('   - . 路径解析: 正常');
  console.log('   - .. 路径解析: 正常');
  console.log('   - 复杂相对路径: 正常');
  console.log('   - 相对路径文件操作: 正常');

  await fs.wipe();
}

async function testCwdDirectoryStack() {
  const fs = createVFS('DirectoryStackTest');

  // 创建目录结构
  await fs.makeDirectory('/home/user', true);
  await fs.makeDirectory('/tmp', true); // 确保创建目录
  await fs.makeDirectory('/var/log', true); // 确保创建目录

  // 测试 pushd
  await fs.chdir('/home/user');
  await fs.pushd('/tmp');
  assertEqual(fs.getCwd(), '/tmp', 'pushd 应该改变当前目录');

  // 测试多次 pushd
  await fs.pushd('/var/log');
  assertEqual(fs.getCwd(), '/var/log', '第二次 pushd 应该改变当前目录');

  // 测试 popd
  await fs.popd();
  assertEqual(fs.getCwd(), '/tmp', 'popd 应该返回到上一个目录');

  await fs.popd();
  assertEqual(fs.getCwd(), '/home/user', '第二次 popd 应该返回到最初的目录');

  // 测试空栈 popd 错误
  try {
    await fs.popd();
    throw new Error('应该抛出错误');
  } catch (error) {
    assert(error instanceof VFSError, '空栈 popd 应该抛出 VFSError');
  }

  console.log('   - pushd 操作: 正常');
  console.log('   - popd 操作: 正常');
  console.log('   - 目录栈管理: 正常');
  console.log('   - 空栈错误处理: 正常');

  await fs.wipe();
}

async function testCwdWithRelativePushd() {
  const fs = createVFS('RelativePushdTest');

  // 创建目录结构
  await fs.makeDirectory('/project/src/components', true);
  await fs.makeDirectory('/project/tests', true);
  await fs.makeDirectory('/project/docs', true);

  // 设置初始目录
  await fs.chdir('/project');

  // 使用相对路径 pushd
  await fs.pushd('src');
  assertEqual(fs.getCwd(), '/project/src', '相对路径 pushd 应该正确工作');

  await fs.pushd('components');
  assertEqual(fs.getCwd(), '/project/src/components', '连续相对路径 pushd 应该正确工作');

  await fs.pushd('../..');
  assertEqual(fs.getCwd(), '/project', '.. 相对路径 pushd 应该正确工作');

  await fs.pushd('./tests');
  assertEqual(fs.getCwd(), '/project/tests', './相对路径 pushd 应该正确工作');

  console.log('   - 相对路径 pushd: 正常');
  console.log('   - 连续相对操作: 正常');
  console.log('   - .. 路径 pushd: 正常');

  await fs.wipe();
}

async function testCwdJoinAndRelative() {
  const fs = createVFS('JoinRelativeTest');

  // 创建目录结构
  await fs.makeDirectory('/workspace/project/src', true);
  await fs.writeFile('/workspace/project/README.md', 'readme');
  await fs.writeFile('/workspace/project/src/index.js', 'code');

  // 设置工作目录
  await fs.chdir('/workspace/project');

  // 测试 join 方法
  assertEqual(
    fs.join('src', 'index.js'),
    '/workspace/project/src/index.js',
    'join 应该基于 CWD 生成绝对路径'
  );

  assertEqual(fs.join('/tmp', 'file.txt'), '/tmp/file.txt', 'join 绝对路径应该直接使用');

  assertEqual(fs.join('.', 'README.md'), '/workspace/project/README.md', 'join 应该处理 . 路径');

  assertEqual(fs.join('..', 'other.txt'), '/workspace/other.txt', 'join 应该处理 .. 路径');

  // 测试 relative 方法
  assertEqual(
    fs.relative('/workspace/project/src/index.js'),
    'src/index.js',
    'relative 应该生成相对于 CWD 的路径'
  );

  assertEqual(fs.relative('/workspace/other.txt'), '../other.txt', 'relative 应该生成正确的 .. 路径');

  assertEqual(fs.relative('/workspace/project'), '.', 'relative 当前目录应该返回 .');

  assertEqual(fs.relative('/tmp/file.txt'), '../../tmp/file.txt', 'relative 应该生成正确的复杂相对路径');

  console.log('   - join 方法: 正常');
  console.log('   - relative 方法: 正常');
  console.log('   - 路径计算: 正常');

  await fs.wipe();
}

async function testCwdErrorHandling() {
  const fs = createVFS('CwdErrorTest');

  // 创建一个文件（不是目录）
  await fs.writeFile('/not-a-directory.txt', 'content');

  // 测试 chdir 到不存在的目录
  try {
    await fs.chdir('/nonexistent');
    throw new Error('应该抛出错误');
  } catch (error) {
    assert(error instanceof VFSError, 'chdir 不存在目录应该抛出 VFSError');
    assertEqual(error['code'], 'ENOENT', '错误代码应该是 ENOENT');
  }

  // 测试 chdir 到文件
  try {
    await fs.chdir('/not-a-directory.txt');
    throw new Error('应该抛出错误');
  } catch (error) {
    assert(error instanceof VFSError, 'chdir 到文件应该抛出 VFSError');
    assertEqual(error['code'], 'ENOTDIR', '错误代码应该是 ENOTDIR');
  }

  // 测试 pushd 到不存在的目录
  try {
    await fs.pushd('/nonexistent');
    throw new Error('应该抛出错误');
  } catch (error) {
    assert(error instanceof VFSError, 'pushd 不存在目录应该抛出 VFSError');
  }

  console.log('   - chdir 错误处理: 正常');
  console.log('   - pushd 错误处理: 正常');

  await fs.wipe();
}

async function testCwdWithMounts() {
  const rootFS = createVFS('RootFS');
  const subFS = createVFS('SubFS');

  // 在子文件系统中创建结构
  await subFS.makeDirectory('/data/files', true);
  await subFS.writeFile('/data/files/config.json', '{"key": "value"}');

  // 挂载子文件系统
  rootFS.mount('/mnt/external', subFS);

  // 在根文件系统中设置 CWD
  await rootFS.chdir('/mnt/external/data');
  assertEqual(rootFS.getCwd(), '/mnt/external/data', 'CWD 应该能设置到挂载点内');

  // 使用相对路径访问挂载的文件
  const content = await rootFS.readFile('files/config.json', { encoding: 'utf8' });
  assertEqual(content, '{"key": "value"}', '应该能通过相对路径访问挂载的文件');

  // 测试在挂载点使用 pushd/popd
  await rootFS.pushd('files');
  assertEqual(rootFS.getCwd(), '/mnt/external/data/files', 'pushd 应该在挂载点内正常工作');

  await rootFS.popd();
  assertEqual(rootFS.getCwd(), '/mnt/external/data', 'popd 应该在挂载点内正常工作');

  console.log('   - 挂载点 CWD: 正常');
  console.log('   - 挂载点相对路径: 正常');
  console.log('   - 挂载点目录栈: 正常');

  await rootFS.wipe();
  await subFS.wipe();
}

async function testCwdGlobWithRelativePaths() {
  const fs = createVFS('CwdGlobTest');

  // 创建测试结构
  await fs.makeDirectory('/project/src', true);
  await fs.makeDirectory('/project/tests', true);
  await fs.writeFile('/project/src/app.js', 'app');
  await fs.writeFile('/project/src/utils.js', 'utils');
  await fs.writeFile('/project/tests/app.test.js', 'test');
  await fs.writeFile('/project/package.json', 'package');

  // 设置工作目录
  await fs.chdir('/project');

  // 测试基于 CWD 的 glob
  const jsFiles = await fs.glob('src/*.js');
  const jsNames = jsFiles.map((r) => r.name).sort();
  assertArrayEqual(jsNames, ['app.js', 'utils.js'], 'glob 应该基于 CWD 工作');

  // 测试相对路径模式
  const allFiles = await fs.glob('**/*.js');
  assert(allFiles.length >= 3, 'glob 应该找到所有 JS 文件');

  // 测试指定不同的 cwd
  const testFiles = await fs.glob('*.js', { cwd: 'tests' });
  const testNames = testFiles.map((r) => r.name);
  assertArrayEqual(testNames, ['app.test.js'], '指定 cwd 应该正确工作');

  console.log('   - CWD 基础 glob: 正常');
  console.log('   - 相对路径 glob: 正常');
  console.log('   - 自定义 cwd glob: 正常');

  await fs.wipe();
}

async function testCwdComplexScenarios() {
  const fs = createVFS('CwdComplexTest');

  // 创建复杂的目录结构
  await fs.makeDirectory('/project/frontend/src/components', true);
  await fs.makeDirectory('/project/backend/api', true);
  await fs.makeDirectory('/project/shared/utils', true);

  await fs.writeFile('/project/frontend/src/App.js', 'frontend app');
  await fs.writeFile('/project/backend/api/server.js', 'backend server');
  await fs.writeFile('/project/shared/utils/helper.js', 'shared helper');

  // 复杂的导航场景
  await fs.chdir('/project');

  // 场景1: 在项目根目录，访问不同模块
  const frontendApp = await fs.readFile('frontend/src/App.js', { encoding: 'utf8' });
  assertEqual(frontendApp, 'frontend app', '应该能访问前端文件');

  const backendServer = await fs.readFile('backend/api/server.js', { encoding: 'utf8' });
  assertEqual(backendServer, 'backend server', '应该能访问后端文件');

  // 场景2: 深入前端目录，然后访问其他模块
  await fs.pushd('frontend/src');
  assertEqual(fs.getCwd(), '/project/frontend/src', '应该进入前端源码目录');

  const sharedHelper = await fs.readFile('../../shared/utils/helper.js', { encoding: 'utf8' });
  assertEqual(sharedHelper, 'shared helper', '应该能通过相对路径访问共享模块');

  // 场景3: 快速切换到后端目录
  await fs.pushd('../../backend/api');
  assertEqual(fs.getCwd(), '/project/backend/api', '应该能快速切换到后端目录');

  // 场景4: 返回到前端目录
  await fs.popd();
  assertEqual(fs.getCwd(), '/project/frontend/src', '应该返回到前端目录');

  // 场景5: 创建新文件使用相对路径
  await fs.writeFile('components/Button.js', 'button component');
  assert(await fs.exists('/project/frontend/src/components/Button.js'), '相对路径创建的文件应该在正确位置');

  console.log('   - 复杂目录导航: 正常');
  console.log('   - 跨模块文件访问: 正常');
  console.log('   - 相对路径文件创建: 正常');

  await fs.wipe();
}

async function testCwdEdgeCases() {
  const fs = createVFS('CwdEdgeTest');

  // 边缘情况1: 空路径处理
  assertEqual(fs.normalizePath(''), '/', '空路径应该返回当前 CWD');

  // 边缘情况2: 多重斜杠处理
  await fs.makeDirectory('/test//dir', true);
  await fs.chdir('/test//dir');
  assertEqual(fs.getCwd(), '/test/dir', '应该规范化多重斜杠');

  // 边缘情况3: 过多的 .. 路径
  assertEqual(fs.normalizePath('../../../../../../../'), '/', '过多的 .. 应该停在根目录');

  // 边缘情况4: 混合 . 和 .. 路径
  await fs.makeDirectory('/a/b/c', true);
  await fs.chdir('/a/b');
  assertEqual(fs.normalizePath('./c/../c/./'), '/a/b/c', '混合 . 和 .. 路径应该正确解析');

  // 边缘情况5: 根目录下的相对操作
  await fs.chdir('/');
  assertEqual(fs.normalizePath('.'), '/', '根目录的 . 应该是根目录');
  assertEqual(fs.normalizePath('..'), '/', '根目录的 .. 应该是根目录');

  console.log('   - 空路径处理: 正常');
  console.log('   - 多重斜杠处理: 正常');
  console.log('   - 过多 .. 处理: 正常');
  console.log('   - 混合路径处理: 正常');
  console.log('   - 根目录边缘情况: 正常');

  await fs.wipe();
}

async function testCwdPerformance() {
  const fs = createVFS('CwdPerfTest');

  // 创建深层目录结构
  let currentPath = '';
  for (let i = 0; i < 20; i++) {
    currentPath += `/level${i}`;
    await fs.makeDirectory(currentPath, true);
  }

  // 性能测试: 大量路径规范化操作
  const start = Date.now();

  await fs.chdir(currentPath);

  for (let i = 0; i < 100; i++) {
    // 各种相对路径操作
    fs.normalizePath('.');
    fs.normalizePath('..');
    fs.normalizePath('../..');
    fs.normalizePath('./file.txt');
    fs.normalizePath('../../other/file.txt');
  }

  const duration = Date.now() - start;
  assert(duration < 100, `路径规范化性能应该足够快 (${duration}ms)`);

  // 性能测试: 目录栈操作
  const stackStart = Date.now();

  // 快速 pushd/popd 操作
  for (let i = 0; i < 50; i++) {
    await fs.pushd('..');
  }

  for (let i = 0; i < 50; i++) {
    await fs.popd();
  }

  const stackDuration = Date.now() - stackStart;
  assert(stackDuration < 200, `目录栈操作性能应该足够快 (${stackDuration}ms)`);

  console.log(`   - 路径规范化性能: 正常 (${duration}ms)`);
  console.log(`   - 目录栈性能: 正常 (${stackDuration}ms)`);

  await fs.wipe();
}

const btn = document.querySelector('#start');
btn.addEventListener('click', function () {
  runAllVFSTests();
});
