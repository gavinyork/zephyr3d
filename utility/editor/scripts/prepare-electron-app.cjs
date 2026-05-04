const fs = require('fs/promises');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const stagingDir = path.join(projectRoot, '.electron-app');

async function copyDirectory(src, dst) {
  await fs.cp(src, dst, {
    recursive: true,
    force: true,
    dereference: false
  });
}

async function main() {
  const packageJson = JSON.parse(await fs.readFile(path.join(projectRoot, 'package.json'), 'utf8'));
  const resolvedStaging = path.resolve(stagingDir);
  if (!resolvedStaging.startsWith(`${projectRoot}${path.sep}`)) {
    throw new Error(`Refusing to write staging directory outside project: ${resolvedStaging}`);
  }

  await fs.rm(resolvedStaging, { recursive: true, force: true });
  await fs.mkdir(resolvedStaging, { recursive: true });
  await copyDirectory(path.join(projectRoot, 'dist'), path.join(resolvedStaging, 'dist'));
  await copyDirectory(path.join(projectRoot, 'electron'), path.join(resolvedStaging, 'electron'));

  const appPackageJson = {
    name: packageJson.name,
    version: packageJson.version,
    description: packageJson.description,
    homepage: packageJson.homepage,
    type: packageJson.type,
    main: packageJson.main,
    author: packageJson.author ?? '',
    license: packageJson.license,
    dependencies: {}
  };
  await fs.writeFile(
    path.join(resolvedStaging, 'package.json'),
    `${JSON.stringify(appPackageJson, null, 2)}\n`,
    'utf8'
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
