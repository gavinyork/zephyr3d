const crossSpawn = require('cross-spawn');
const fs = require('fs');
const path = require('path');
const yargs = require('yargs/yargs');

const apiExtacter = path.join(__dirname, 'node_modules', '.bin', 'api-extractor');
const apiDocumenter = path.join(__dirname, 'node_modules', '.bin', 'api-documenter');

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
  process.chdir(path.resolve(__dirname, 'dist/web/doc'));
  spawnSync(apiDocumenter, ['markdown']);
}

function extract(projectName, projectPath) {
  process.chdir(projectPath);
  const config = {
    "$schema": "https://developer.microsoft.com/json-schemas/api-extractor/v7/api-extractor.schema.json",
    "projectFolder": '.',
    "mainEntryPointFilePath": "<projectFolder>/dist/index.d.ts",
    "bundledPackages": [],
    "compiler": {
      "tsconfigFilePath": "<projectFolder>/tsconfig.json"
    },
    "apiReport": {
      "enabled": true,
      "reportFileName": `${projectName}.api.md`,
      "reportFolder": "<projectFolder>/../../site/report",
      "reportTempFolder": "<projectFolder>/../../site/report"
    },
    "docModel": {
      "enabled": true,
      "projectFolderUrl": "http://localhost:3000/#/doc/markdown",
      "apiJsonFilePath": `<projectFolder>/../../site/dist/web/doc/input/${projectName}.api.json`,
    },
    "dtsRollup": {
      "enabled": false
    },
    "tsdocMetadata": {
      "enabled": false
    }
  }
  fs.writeFileSync('api-extractor.json', JSON.stringify(config, null, 2));
  spawnSync(apiExtacter, ['run', '--local', '--verbose']);
  fs.rmSync('api-extractor.json');
}

const projects = ['base', 'device', 'imgui', 'scene', 'backend-webgl', 'backend-webgpu'];
const cwd = process.cwd();
for (const name of projects) {
  const projectPath = path.resolve(__dirname, '..', 'libs', name);
  if (fs.existsSync(projectPath)) {
    extract(name, projectPath);
  } else {
    console.error(`project not found: ${projectName}`);
  }
}
document();

const markdownDir = path.join(__dirname, 'dist', 'web', 'doc', 'markdown');
const r = /(\[[^\]]+\])\(([^\)]+\.md)\)/g;
fs.readdirSync(markdownDir).forEach((file) => {
  const fullpath = path.join(markdownDir, file);
  if (fullpath.endsWith('.md') && fs.statSync(fullpath).isFile()) {
    const content = fs.readFileSync(fullpath, { encoding: 'utf-8' });
    try {
      const newcontent = content.replaceAll(r, '$1(doc/markdown/$2)');
      if (newcontent !== content) {
        fs.writeFileSync(fullpath, newcontent, { encoding: 'utf-8' });
      }
    } catch (err) {
      console.log(`${typeof content} ${fullpath}`);
    }
  }
});

process.chdir(cwd);

