const { execFile } = require('child_process');
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

async function execFileAsync(file, args) {
  await new Promise((resolve, reject) => {
    execFile(file, args, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function generateMacIcon(projectRoot, stagingRoot) {
  if (process.platform !== "darwin") {
    return;
  }

  const preferredSourceIcon = path.join(projectRoot, "public", "images", "icon1024.png");
  const fallbackSourceIcon = path.join(projectRoot, "public", "images", "icon.png");
  const sourceIcon = (await fs.access(preferredSourceIcon).then(() => preferredSourceIcon).catch(() => fallbackSourceIcon));
  const iconsetDir = path.join(stagingRoot, "electron", "icon.iconset");
  const targetIcon = path.join(stagingRoot, "electron", "icon.icns");
  const sizes = [16, 32, 128, 256, 512];

  await fs.rm(iconsetDir, { recursive: true, force: true });
  await fs.mkdir(iconsetDir, { recursive: true });

  for (const size of sizes) {
    const basePath = path.join(iconsetDir, `icon_${size}x${size}.png`);
    await execFileAsync("sips", [
      "-s",
      "format",
      "png",
      "-z",
      String(size),
      String(size),
      sourceIcon,
      "--out",
      basePath
    ]);
    const retinaSize = size * 2;
    const retinaPath = path.join(iconsetDir, `icon_${size}x${size}@2x.png`);
    await execFileAsync("sips", [
      "-s",
      "format",
      "png",
      "-z",
      String(retinaSize),
      String(retinaSize),
      sourceIcon,
      "--out",
      retinaPath
    ]);
  }

  await execFileAsync("iconutil", ["-c", "icns", iconsetDir, "-o", targetIcon]);
  await fs.rm(iconsetDir, { recursive: true, force: true });
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
  await copyDirectory(path.join(projectRoot, 'mcp'), path.join(resolvedStaging, 'mcp'));
  await generateMacIcon(projectRoot, resolvedStaging);

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
