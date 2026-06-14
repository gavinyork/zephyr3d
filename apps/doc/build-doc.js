const crossSpawn = require('cross-spawn');
const fs = require('fs');
const path = require('path');

const apiExtacter = path.join(__dirname, 'node_modules', '.bin', 'api-extractor');
const apiDocumenter = path.join(__dirname, 'node_modules', '.bin', 'api-documenter');
const apiOutputDir = path.join(__dirname, 'web', 'api');

function spawnSync(cmd, args, cwd) {
  const child = crossSpawn.sync(cmd, args, {
    cwd: cwd ?? process.cwd(),
    env: process.env,
    stdio: 'inherit'
  });
  if (child.status !== 0) {
    process.exit(child.status);
  }
}

function document() {
  process.chdir(apiOutputDir);
  spawnSync(apiDocumenter, ['markdown']);
}

function extract(projectName, projectPath) {
  process.chdir(projectPath);
  const configPath = path.join(projectPath, 'api-extractor.json');
  const config = {
    $schema: 'https://developer.microsoft.com/json-schemas/api-extractor/v7/api-extractor.schema.json',
    projectFolder: '.',
    mainEntryPointFilePath: '<projectFolder>/dist/index.d.ts',
    bundledPackages: [],
    compiler: {
      tsconfigFilePath: '<projectFolder>/tsconfig.json'
    },
    apiReport: {
      enabled: true,
      reportFileName: `${projectName}.api.md`,
      reportFolder: '<projectFolder>/../../apps/doc/report',
      reportTempFolder: '<projectFolder>/../../apps/doc/report'
    },
    docModel: {
      enabled: true,
      projectFolderUrl: 'https://zephyr3d.org/doc/api/markdown',
      apiJsonFilePath: `<projectFolder>/../../apps/doc/web/api/input/${projectName}.api.json`
    },
    dtsRollup: {
      enabled: false
    },
    tsdocMetadata: {
      enabled: false
    }
  };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  spawnSync(apiExtacter, ['run', '--local', '--verbose']);
  try {
    fs.rmSync(configPath, { force: true });
  } catch (err) {
    console.warn(`failed to remove temporary api-extractor config for ${projectName}: ${err.message}`);
  }
}

const projects = ['base', 'device', 'loaders', 'imgui', 'scene', 'backend-webgl', 'backend-webgpu'];
const cwd = process.cwd();
fs.rmSync(apiOutputDir, { recursive: true, force: true });
fs.mkdirSync(path.join(apiOutputDir, 'input'), { recursive: true });
for (const name of projects) {
  const projectPath = path.resolve(__dirname, '..', '..', 'libs', name);
  if (fs.existsSync(projectPath)) {
    extract(name, projectPath);
  } else {
    console.error(`project not found: ${projectName}`);
  }
}
document();

const markdownDir = path.join(apiOutputDir, 'markdown');
const r = /(\[[^\]]+\])\(([^\)]+\.md)\)/g;
fs.readdirSync(markdownDir).forEach((file) => {
  const fullpath = path.join(markdownDir, file);
  if (fullpath.endsWith('.md') && fs.statSync(fullpath).isFile()) {
    const content = fs.readFileSync(fullpath, { encoding: 'utf-8' });
    try {
      const newcontent = content
        .replaceAll(r, (match, text, href) => {
          const normalizedHref = href
            .replace(/^doc\/markdown\/\.?\//, './')
            .replace(/^\/doc\/markdown\/\.?\//, './')
            .toLowerCase();
          return `${text}(${normalizedHref})`;
        })
        .replace(/^\{[^\r\n]*\}$/gm, (line) => `\`${line}\``);
      if (newcontent !== content) {
        fs.writeFileSync(fullpath, newcontent, { encoding: 'utf-8' });
      }
    } catch (err) {
      console.log(`${typeof content} ${fullpath}`);
    }
  }
});

process.chdir(cwd);
