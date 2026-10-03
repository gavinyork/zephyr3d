import type * as TS from 'typescript';
import { rollup } from '@rollup/browser';
import { vfsAndUrlPlugin } from './plugins/vfsurl';
import { tsTranspilePlugin } from './plugins/tstranspile';
import type { VFS } from '@zephyr3d/base';
import { depsResolvePlugin } from './plugins/depresolve';
import { ProjectService } from '../services/project';
import { DEFAULT_SPLASH_BACKGROUND, generateIndexHTML, libDir, projectFileName } from './templates';
import { isAssetMetaPath, ASSET_MANIFEST_FILE, readZmshBinary } from '@zephyr3d/scene';
import { getVertexFormatSize } from '@zephyr3d/device';
import type { VertexAttribFormat } from '@zephyr3d/device';
import type { AssetManifest, AssetSourceKind } from '@zephyr3d/scene';
import { DerivedAssetService, getDerivedAssetKind } from '../services/derivedassets';

function rewriteImports(code: string): string {
  const reStatic = /\b(?:import|export)\s+[^"']*?from\s+(['"])([^'"]+)\1/g;
  const reDynamic = /\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g;

  const replaceAsync = (input: string, re: RegExp) => {
    let out = '';
    let last = 0;
    for (;;) {
      const m = re.exec(input);
      if (!m) {
        break;
      }
      out += input.slice(last, m.index);

      const quote = m[1];
      const spec = m[2];
      let replacement = spec;

      if ((spec.startsWith('./') || spec.startsWith('../')) && !spec.endsWith('.js')) {
        if (spec.endsWith('.ts')) {
          replacement = `${spec.slice(0, -3)}.js`;
        } else {
          replacement = `${spec}.js`;
        }
      }

      const replaced = m[0].replace(`${quote}${spec}${quote}`, `${quote}${replacement}${quote}`);
      out += replaced;
      last = m.index + m[0].length;
    }
    out += input.slice(last);
    return out;
  };

  let out = replaceAsync(code, reStatic);
  out = replaceAsync(out, reDynamic);
  return out;
}

function transpileTS(fileName: string, code: string) {
  const ts = (window as any).ts as typeof TS;
  if (!ts) {
    throw new Error('TypeScript runtime (window.ts) not found. Load typescript.js first.');
  }

  const res = ts.transpileModule(code, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      sourceMap: true,
      inlineSources: true,
      experimentalDecorators: true,
      useDefineForClassFields: false
    },
    fileName
  });

  let out = res.outputText || '';
  if (res.sourceMapText) {
    const mapBase64 = btoa(unescape(encodeURIComponent(res.sourceMapText)));
    out += `\n//# sourceMappingURL=data:application/json;base64,${mapBase64}`;
  }
  out += `\n//# sourceURL=${fileName}`;
  return out;
}

// Decoders a bundled package fetches relative to its own module at runtime (KTX2
// transcoder, Draco); the editor's build places them beside its module copies
const RUNTIME_DECODERS: Record<string, { dir: string; files: string[] }> = {
  scene: { dir: 'basis', files: ['basis_transcoder.js', 'basis_transcoder.wasm', 'LICENSE'] },
  loaders: { dir: 'draco', files: ['draco_wasm_wrapper_gltf.js', 'draco_decoder_gltf.wasm', 'LICENSE'] }
};

async function copyRuntimeDecoders(vfs: VFS, name: string, packageDir: string) {
  const decoders = RUNTIME_DECODERS[name];
  if (!decoders) {
    return;
  }
  for (const file of decoders.files) {
    const response = await fetch(`./modules/${decoders.dir}/${file}`);
    if (!response.ok) {
      throw new Error(`Missing runtime decoder modules/${decoders.dir}/${file} (HTTP ${response.status})`);
    }
    await vfs.writeFile(vfs.join(packageDir, decoders.dir, file), await response.arrayBuffer(), {
      encoding: 'binary',
      create: true
    });
  }
}

export async function getImportMap(vfs: VFS, distDir: string, writeDependencies = true) {
  const importMap: Record<string, string> = {};
  const depsDir = vfs.join(distDir, `${libDir}/deps`);
  if (writeDependencies) {
    await vfs.makeDirectory(depsDir, true);
  }
  for (const name of [
    'base',
    'device',
    'scene',
    'runtime',
    'loaders',
    'imgui',
    'backend-webgl',
    'backend-webgpu'
  ]) {
    const path = vfs.join(depsDir, `@zephyr3d/${name}/index.js`);
    if (writeDependencies) {
      const content = await (await fetch(`./modules/zephyr3d_${name}.js`)).text();
      await vfs.writeFile(path, content, { encoding: 'utf8', create: true });
      await copyRuntimeDecoders(vfs, name, vfs.join(depsDir, `@zephyr3d/${name}`));
    }
    importMap[`@zephyr3d/${name}`] = `./${vfs.relative(path, distDir)}`;
  }
  if ((await vfs.exists(`/${libDir}/deps.lock.json`)) && (await vfs.exists(`/${libDir}/deps`))) {
    if (
      (await vfs.stat(`/${libDir}/deps.lock.json`)).isFile &&
      (await vfs.stat(`/${libDir}/deps`)).isDirectory
    ) {
      const content = (await vfs.readFile(`/${libDir}/deps.lock.json`, { encoding: 'utf8' })) as string;
      const packages = JSON.parse(content) as { dependencies: Record<string, { entry: string }> };
      for (const k of Object.keys(packages.dependencies)) {
        importMap[k] = packages.dependencies[k].entry;
      }
      if (writeDependencies) {
        await vfs.copyFile(`/${libDir}/deps.lock.json`, `/dist/${libDir}/deps.lock.json`);
        await vfs.copyFileEx(`/${libDir}/deps/**/*`, depsDir, { cwd: `/${libDir}/deps` });
      }
    }
  }
  return { imports: importMap };
}

/** Per-asset line of the build report, for assets the pipeline may compress */
export interface BuildAssetReport {
  kind: AssetSourceKind;
  path: string;
  shipped: string;
  sourceBytes: number;
  shippedBytes: number;
  /** Texture dimensions of a shipped KTX2, 0 otherwise */
  width: number;
  height: number;
  /** Vertex buffer bytes on the GPU of a mesh before and after compression, 0 for textures */
  gpuBytesBefore?: number;
  gpuBytesAfter?: number;
  /** Set when the asset had to ship uncompressed although settings asked for compression */
  error?: string;
}

function ktx2Dimensions(data: ArrayBuffer) {
  // KTX2 header: 12-byte identifier, vkFormat, typeSize, then pixelWidth/pixelHeight
  const view = new DataView(data);
  return data.byteLength >= 28 ? { width: view.getUint32(20, true), height: view.getUint32(24, true) } : null;
}

/** Vertex buffer sizes on the GPU of a source .zmsh and of its compressed copy */
async function meshGpuBytes(vfs: VFS, sourcePath: string, derived: ArrayBuffer) {
  try {
    const { header } = readZmshBinary(derived);
    const strideAfter = header.attributes.reduce((n, a) => n + getVertexFormatSize(a.format), 0);
    const source = JSON.parse((await vfs.readFile(sourcePath, { encoding: 'utf8' })) as string);
    const formats = Object.values(source.data.vertices as Record<string, { format: VertexAttribFormat }>);
    const strideBefore = formats.reduce((n, v) => n + getVertexFormatSize(v.format), 0);
    return {
      gpuBytesBefore: header.vertexCount * strideBefore,
      gpuBytesAfter: header.vertexCount * strideAfter
    };
  } catch {
    return null;
  }
}

/**
 * Ships a texture or mesh: its derived copy (KTX2, binary .zmsh) under a
 * content-hashed name next to where the source was, or the source itself when
 * it is not compressed. Returns the shipped path, which goes into the manifest
 * when it differs from the source.
 */
async function shipDerivedAsset(
  vfs: VFS,
  distDir: string,
  path: string,
  kind: AssetSourceKind,
  report: BuildAssetReport[]
) {
  const sourceBytes = (await vfs.stat(path)).size;
  let derived: string | null = null;
  let error: string | undefined;
  try {
    derived = await DerivedAssetService.getDerivedFile(path);
  } catch (err) {
    error = String(err);
    console.warn(`Shipping ${path} uncompressed: ${error}`);
  }
  if (!derived) {
    await vfs.copyFile(path, vfs.join(distDir, path), { overwrite: true });
    report.push({
      kind,
      path,
      shipped: path,
      sourceBytes,
      shippedBytes: sourceBytes,
      width: 0,
      height: 0,
      error
    });
    return path;
  }
  const data = (await vfs.readFile(derived, { encoding: 'binary' })) as ArrayBuffer;
  const hash = derived.slice(derived.lastIndexOf('/') + 1, derived.lastIndexOf('.')).slice(0, 8);
  const stem = path.slice(0, path.lastIndexOf('.'));
  const shipped = `${stem}.${hash}${derived.slice(derived.lastIndexOf('.'))}`;
  await vfs.writeFile(vfs.join(distDir, shipped), data, { encoding: 'binary', create: true });
  const size = kind === 'texture' ? ktx2Dimensions(data) : null;
  const gpu = kind === 'primitive' ? await meshGpuBytes(vfs, path, data) : null;
  report.push({
    ...gpu,
    kind,
    path,
    shipped,
    sourceBytes,
    shippedBytes: data.byteLength,
    width: size?.width ?? 0,
    height: size?.height ?? 0
  });
  return shipped;
}

/**
 * Makes sure the splash image is in the build as the browser can show it. The
 * asset pipeline may have shipped only a KTX2 copy of it, which an <img> can't
 * display, so the source is copied to its own path when missing.
 *
 * @returns Page-relative URL of the image, empty when there is none
 */
async function shipSplashImage(vfs: VFS, distDir: string, path: string | undefined) {
  if (!path) {
    return '';
  }
  path = vfs.normalizePath(path);
  if (!(await vfs.exists(path))) {
    console.warn(`Splash image '${path}' not found, building without it`);
    return '';
  }
  const shipped = vfs.join(distDir, path);
  if (!(await vfs.exists(shipped))) {
    await vfs.copyFile(path, shipped, { overwrite: true });
  }
  return encodeURI(`.${path}`);
}

/** Specifier of a static import (`import 'x'`, `import a from 'x'`) or re-export (`export * from 'x'`) */
const STATIC_IMPORT_RE =
  /^[ \t]*(?:import\s*(['"])([^'"\n]+)\1|(?:import|export)\b[^'";]*?\bfrom\s*(['"])([^'"\n]+)\3)/gm;

/**
 * Collects the static module graph of the build starting at index.js, as
 * page-relative URLs. Without preloading, the browser only learns of a module
 * after parsing the one importing it, so engine modules download one level of
 * the graph at a time.
 */
async function collectStaticModules(vfs: VFS, distDir: string, imports: Record<string, string>) {
  const urls: string[] = [];
  const queue = ['./index.js'];
  const seen = new Set(queue);
  while (queue.length > 0) {
    const url = queue.shift()!;
    urls.push(url);
    const path = vfs.normalizePath(vfs.join(distDir, url));
    if (!/^\.\.?\//.test(url) || !(await vfs.exists(path))) {
      continue;
    }
    const code = (await vfs.readFile(path, { encoding: 'utf8' })) as string;
    for (const m of code.matchAll(STATIC_IMPORT_RE)) {
      const spec = m[2] ?? m[4];
      const dep = imports[spec]
        ? imports[spec]
        : spec.startsWith('./') || spec.startsWith('../')
          ? `./${vfs.relative(vfs.normalizePath(vfs.join(vfs.dirname(path), spec)), distDir)}`
          : null;
      if (dep && !seen.has(dep)) {
        seen.add(dep);
        queue.push(dep);
      }
    }
  }
  return urls;
}

/**
 * Head markup preloading the modules index.js needs, so they all download in
 * parallel with the page. The rendering backend is imported dynamically once
 * index.js runs; a small script preloads the one it is going to pick, using the
 * same order (WebGPU, then WebGL) on the RHIs the project targets.
 */
async function generateModulePreloads(
  vfs: VFS,
  distDir: string,
  imports: Record<string, string>,
  preferredRHI: string[]
) {
  const links = (await collectStaticModules(vfs, distDir, imports)).map(
    (url) => `<link rel="modulepreload" href="${encodeURI(url)}" />`
  );
  const rhi = preferredRHI.map((val) => val.toLowerCase());
  const webgpu = rhi.includes('webgpu') ? imports['@zephyr3d/backend-webgpu'] : null;
  const webgl = rhi.some((val) => val.startsWith('webgl')) ? imports['@zephyr3d/backend-webgl'] : null;
  if (webgpu || webgl) {
    links.push(`<script>
  (() => {
    const webgpu = ${JSON.stringify(webgpu ?? null)};
    const webgl = ${JSON.stringify(webgl ?? null)};
    const href = webgpu && navigator.gpu ? webgpu : webgl;
    if (href) {
      const link = document.createElement('link');
      link.rel = 'modulepreload';
      link.href = href;
      document.head.appendChild(link);
    }
  })();
</script>`);
  }
  return links.join('\n');
}

export async function buildForEndUser(options: {
  input: string | string[] | Record<string, string>;
  distDir?: string;
  alias?: Record<string, string>;
  sourcemap?: boolean | 'inline' | 'hidden';
  format?: 'es' | 'iife' | 'umd' | 'cjs';
  onProgress?: (message: string, current: number, total: number) => void;
}) {
  const { input, distDir = '/dist', alias = {}, sourcemap = false, format = 'es', onProgress } = options;
  const vfs = ProjectService.VFS;

  const bundle = await rollup({
    input,
    plugins: [
      vfsAndUrlPlugin(vfs, { vfsRoot: '/', distDir, alias }),
      depsResolvePlugin(vfs, '/'),
      tsTranspilePlugin({ compilerOptions: { sourceMap: sourcemap !== false } })
    ]
  });

  const { output } = await bundle.generate({
    format,
    sourcemap,
    entryFileNames: 'index.js',
    chunkFileNames: 'assets/chunk-[hash].js',
    assetFileNames: 'assets/[name]-[hash][extname]'
  });

  await bundle.close();

  // copy asset files to dist
  const assetFileList = await vfs.glob('assets/**/*', {
    includeHidden: true,
    includeDirs: false,
    includeFiles: true,
    recursive: true
  });
  // .zmeta sidecars only steer the editor's asset pipeline and are not shipped
  const assetFiles = assetFileList.filter((path) => path.type === 'file' && !isAssetMetaPath(path.path));
  const manifest: Required<AssetManifest> = { version: 1, textures: {}, primitives: {} };
  const assetReport: BuildAssetReport[] = [];
  for (let i = 0; i < assetFiles.length; i++) {
    const file = assetFiles[i];
    onProgress?.(`Packaging ${file.path}`, i, assetFiles.length);
    const kind = getDerivedAssetKind(file.path);
    if (kind && !file.path.startsWith('/assets/@builtins/')) {
      const shipped = await shipDerivedAsset(vfs, distDir, file.path, kind, assetReport);
      if (shipped !== file.path) {
        (kind === 'texture' ? manifest.textures : manifest.primitives)[file.path] = shipped;
      }
      continue;
    }
    const isTS = file.path.endsWith('.ts');
    let content = await vfs.readFile(file.path, { encoding: isTS ? 'utf8' : 'binary' });
    let path = file.path;
    if (isTS) {
      content = transpileTS(file.path, rewriteImports(content as string));
      path = `${path.slice(0, -3)}.js`;
    }
    await vfs.writeFile(vfs.join(distDir, path), content, {
      create: true,
      encoding: isTS ? 'utf8' : 'binary'
    });
  }

  onProgress?.('Writing runtime', assetFiles.length, assetFiles.length);
  if (Object.keys(manifest.textures).length > 0 || Object.keys(manifest.primitives).length > 0) {
    await vfs.writeFile(vfs.join(distDir, ASSET_MANIFEST_FILE), JSON.stringify(manifest, null, 2), {
      encoding: 'utf8',
      create: true
    });
  }

  const importMap = await getImportMap(vfs, distDir);

  const settings = await ProjectService.getCurrentProjectSettings();
  const info = await ProjectService.getCurrentProjectInfo();
  const favicon = settings.favicon
    ? `<link rel="icon" type="${vfs.guessMIMEType(settings.favicon)}" href=".${settings.favicon}" />`
    : '';
  const splashImage = await shipSplashImage(vfs, distDir, settings.splashImage);
  let htmlContent = generateIndexHTML({
    title: settings.title ?? info.name,
    head: favicon,
    splashImage,
    splashBackground: settings.splashBackground ?? DEFAULT_SPLASH_BACKGROUND
  });
  htmlContent = htmlContent.replace('</body>', `  <script type="module" src="./index.js"></script>\n</body>`);
  // Module preloads must follow the import map, which a module load freezes
  const preloads = await generateModulePreloads(vfs, distDir, importMap.imports, settings.preferredRHI ?? []);
  htmlContent = htmlContent.replace(
    '</head>',
    `<script type="importmap">\n${JSON.stringify(importMap, null, 2)}\n</script>\n${preloads}\n</head>`
  );
  await vfs.writeFile(vfs.join(distDir, 'index.html'), htmlContent, {
    encoding: 'utf8',
    create: true
  });

  await vfs.writeFile(vfs.join(distDir, projectFileName), JSON.stringify(settings, null, 2), {
    encoding: 'utf8',
    create: true
  });

  return { distDir, output, assetReport };
}
