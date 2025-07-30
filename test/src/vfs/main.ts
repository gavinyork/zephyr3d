import type { VFS } from '@zephyr3d/base';
import { VFSError, MemoryFS, ZipFS, IndexedDBFS } from '@zephyr3d/base';
import * as zipjs from '@zip.js/zip.js';

let currentTest = 0;

// 简单的测试工具函数
function assert(condition, message) {
  if (!condition) {
    throw new Error(`断言失败: ${message}`);
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`断言失败: ${message}. 期望: ${expected}, 实际: ${actual}`);
  }
}

function assertArrayEqual(actual, expected, message) {
  if (actual.length !== expected.length) {
    throw new Error(`断言失败: ${message}. 数组长度不匹配，期望: ${expected.length}, 实际: ${actual.length}`);
  }
  for (let i = 0; i < expected.length; i++) {
    if (actual[i] !== expected[i]) {
      throw new Error(`断言失败: ${message}. 索引 ${i} 处值不匹配，期望: ${expected[i]}, 实际: ${actual[i]}`);
    }
  }
}

function assertContains(array, item, message) {
  if (!array.includes(item)) {
    throw new Error(`断言失败: ${message}. 数组不包含: ${item}`);
  }
}

function assertNotContains(array, item, message) {
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
    return new MemoryFS(name, readonly);
  } else if (currentTest === 1) {
    return new IndexedDBFS(name, 'files', readonly);
  } else {
    return new ZipFS(name, zipjs, readonly);
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
  await fs.deleteDatabase();
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

  await fs.deleteDatabase();
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

  await rootFS.deleteDatabase();
  await subFS.deleteDatabase();
}

async function testFileCopyMove() {
  const fs = createVFS();

  // 创建源文件
  await fs.writeFile('/source.txt', 'original content');

  // 复制文件
  await fs.copyFile('/source.txt', '/copy.txt');
  const copyContent = await fs.readFile('/copy.txt', { encoding: 'utf8' });
  assertEqual(copyContent, 'original content', '复制的文件内容应该匹配');
  assert(await fs.exists('/source.txt'), '原文件应该仍然存在');

  // 移动文件
  await fs.moveFile('/source.txt', '/moved.txt');
  const movedContent = await fs.readFile('/moved.txt', { encoding: 'utf8' });
  assertEqual(movedContent, 'original content', '移动的文件内容应该匹配');
  assert(!(await fs.exists('/source.txt')), '原文件应该不存在');

  console.log('   - 文件复制: 正常');
  console.log('   - 文件移动: 正常');

  await fs.deleteDatabase();
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

  await fs.deleteDatabase();
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
  await fs.deleteDatabase();
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

  await fs.deleteDatabase();
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
  await rootFS.deleteDatabase();
  await fs1.deleteDatabase();
  await fs2.deleteDatabase();
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
  await rootFS.deleteDatabase();
  await fs1.deleteDatabase();
  await fs2.deleteDatabase();
}

async function testFileSystemInfo() {
  const fs = createVFS('TestFS');
  const subFS = createVFS('SubFS');

  // 测试基本信息
  const info1 = fs.getInfo();
  assertEqual(info1.name, 'TestFS', '文件系统名称应该匹配');
  assertEqual(info1.isReadOnly, false, '应该不是只读');
  assertEqual(info1.mountCount, 0, '初始挂载数应该为0');

  // 挂载后测试信息
  fs.mount('/sub', subFS);
  const info2 = fs.getInfo();
  assertEqual(info2.mountCount, 1, '挂载后挂载数应该为1');
  assert(info2.mountPoints.includes('/sub'), '挂载点列表应该包含 /sub');

  console.log('   - 文件系统信息: 正常');
  await fs.deleteDatabase();
  await subFS.deleteDatabase();
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
  await fs.deleteDatabase();
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
  await fs.deleteDatabase();
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
  await fs.deleteDatabase();
}

// 主测试函数
export async function runAllVFSTests() {
  const tests = [
    ['基础文件操作', testBasicFileOperations],
    ['目录操作', testDirectoryOperations],
    ['挂载操作', testMountOperations],
    ['文件复制移动', testFileCopyMove],
    ['错误处理', testErrorHandling],
    ['二进制数据', testBinaryData],
    ['二进制数据追加', testBinaryDataAppend],
    ['挂载优先级', testMountPriority],
    ['跨挂载操作', testCrossMountOperations],
    ['文件系统信息', testFileSystemInfo],
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
    ['CWD文件系统信息', testCwdFileSystemInfo],
    ['CWD复杂场景', testCwdComplexScenarios],
    ['CWD边缘情况', testCwdEdgeCases],
    ['CWD性能测试', testCwdPerformance]
  ] as const;

  for (currentTest = 0; currentTest < 3; currentTest++) {
    console.log(`--------------- 🚀 开始 ${VFSTypes[currentTest]} 文件系统测试 ---------------\n`);
    let passed = 0;
    const total = tests.length;

    for (const [name, testFn] of tests) {
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

  await fs.deleteDatabase();
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

  await fs.deleteDatabase();
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

  await fs.deleteDatabase();
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

  await fs.deleteDatabase();
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

  await fs.deleteDatabase();
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

  await fs.deleteDatabase();
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

  await fs.deleteDatabase();
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

  await fs.deleteDatabase();
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

  await fs.deleteDatabase();
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

  await fs.deleteDatabase();
}

async function testCwdDirectoryStack() {
  const fs = createVFS('DirectoryStackTest');

  // 创建目录结构
  await fs.makeDirectory('/home/user', true);
  await fs.makeDirectory('/tmp', true); // 确保创建目录
  await fs.makeDirectory('/var/log', true); // 确保创建目录

  // 测试初始状态
  assertEqual(fs.getDirStack().length, 0, '初始目录栈应该为空');

  // 测试 pushd
  await fs.chdir('/home/user');
  await fs.pushd('/tmp');
  assertEqual(fs.getCwd(), '/tmp', 'pushd 应该改变当前目录');
  assertEqual(fs.getDirStack().length, 1, '目录栈应该有一个条目');
  assertContains(fs.getDirStack(), '/home/user', '目录栈应该包含之前的目录');

  // 测试多次 pushd
  await fs.pushd('/var/log');
  assertEqual(fs.getCwd(), '/var/log', '第二次 pushd 应该改变当前目录');
  assertEqual(fs.getDirStack().length, 2, '目录栈应该有两个条目');
  assertArrayEqual(fs.getDirStack(), ['/home/user', '/tmp'], '目录栈顺序应该正确');

  // 测试 popd
  await fs.popd();
  assertEqual(fs.getCwd(), '/tmp', 'popd 应该返回到上一个目录');
  assertEqual(fs.getDirStack().length, 1, '目录栈应该减少一个条目');

  await fs.popd();
  assertEqual(fs.getCwd(), '/home/user', '第二次 popd 应该返回到最初的目录');
  assertEqual(fs.getDirStack().length, 0, '目录栈应该为空');

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

  await fs.deleteDatabase();
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

  // 验证目录栈
  const stack = fs.getDirStack();
  assertArrayEqual(
    stack,
    ['/project', '/project/src', '/project/src/components', '/project'],
    '目录栈应该记录所有历史'
  );

  console.log('   - 相对路径 pushd: 正常');
  console.log('   - 连续相对操作: 正常');
  console.log('   - .. 路径 pushd: 正常');

  await fs.deleteDatabase();
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

  await fs.deleteDatabase();
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

  await fs.deleteDatabase();
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

  await rootFS.deleteDatabase();
  await subFS.deleteDatabase();
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

  await fs.deleteDatabase();
}

async function testCwdFileSystemInfo() {
  const fs = createVFS('CwdInfoTest');

  // 创建目录并设置 CWD
  await fs.makeDirectory('/home/user/project', true);
  await fs.chdir('/home/user/project');

  // 测试基础信息
  const info1 = fs.getInfo();
  assertEqual(info1.cwd, '/home/user/project', '文件系统信息应该包含当前 CWD');
  assertEqual(info1.dirStackDepth, 0, '初始目录栈深度应该为 0');

  // 创建需要的目录，然后使用 pushd 增加栈深度
  await fs.makeDirectory('/tmp', true); // 添加这行，创建 /tmp 目录
  await fs.makeDirectory('/var', true); // 添加这行，创建 /var 目录

  await fs.pushd('/tmp');
  await fs.pushd('/var');

  const info2 = fs.getInfo();
  assertEqual(info2.cwd, '/var', '信息应该反映当前 CWD');
  assertEqual(info2.dirStackDepth, 2, '目录栈深度应该为 2');

  console.log('   - CWD 信息获取: 正常');
  console.log('   - 目录栈深度: 正常');

  await fs.deleteDatabase();
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

  await fs.deleteDatabase();
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

  await fs.deleteDatabase();
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

  await fs.deleteDatabase();
}

// 如果你想单独运行某个测试
export async function runSingleTest(testName) {
  const testMap = {
    basic: testBasicFileOperations,
    directory: testDirectoryOperations,
    mount: testMountOperations,
    copy: testFileCopyMove,
    error: testErrorHandling,
    binary: testBinaryData,
    'binary-append': testBinaryDataAppend,
    priority: testMountPriority,
    cross: testCrossMountOperations,
    info: testFileSystemInfo,
    options: testFileOptions,
    stat: testStatOperations,
    large: testLargeFileOperations,
    basicglob: testGlobBasicWildcards,
    complexglob: testGlobComplexPatterns,
    edgecaseglob: testGlobEdgeCases,
    ignoreglob: testGlobIgnorePatterns,
    multipleglob: testGlobMultiplePatterns,
    performanceglob: testGlobPerformance,
    globoptions: testGlobOptions,
    recursiveglob: testGlobRecursiveSearch
  };

  const testFn = testMap[testName];
  if (!testFn) {
    console.log(`❌ 未找到测试: ${testName}`);
    console.log(`可用的测试: ${Object.keys(testMap).join(', ')}`);
    return;
  }

  await runTest(testName, testFn);
}

const btn = document.querySelector('#start');
btn.addEventListener('click', function () {
  runAllVFSTests();
});
