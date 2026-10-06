const fs = require('fs/promises');
const path = require('path');
const ts = require('typescript');

const projectRoot = path.resolve(__dirname, '..');
const vendorRoot = path.join(projectRoot, 'dist', 'vendor', 'zephyr3d');
const vendorRootNormalized = vendorRoot.replace(/\\/g, '/');
const outputDir = path.join(projectRoot, 'dist', 'assistant');
const outputPath = path.join(outputDir, 'zephyr-types-index.json');
const packageNames = ['base', 'device', 'scene', 'physics', 'imgui', 'backend-webgl', 'backend-webgpu'];

function normalizeWhitespace(value) {
  return String(value || '')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function limitText(value, maxLength) {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function tokenize(value) {
  const normalized = String(value || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[^a-zA-Z0-9_]+/g, ' ')
    .toLowerCase();
  return [...new Set(normalized.split(/\s+/).filter(Boolean))];
}

function getNodeName(node) {
  if (!node) {
    return '';
  }
  if (ts.isConstructorDeclaration(node)) {
    return 'constructor';
  }
  if ('name' in node && node.name) {
    if (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) || ts.isNumericLiteral(node.name)) {
      return node.name.text;
    }
    return node.name.getText();
  }
  return '';
}

function getDocumentationForSymbol(symbol, checker) {
  if (!symbol) {
    return '';
  }
  const docs = ts.displayPartsToString(symbol.getDocumentationComment(checker));
  if (!docs) {
    return '';
  }
  return normalizeWhitespace(docs);
}

function cleanJsDocBlock(block) {
  return normalizeWhitespace(
    String(block || '')
      .replace(/^\/\*\*?/, '')
      .replace(/\*\/$/, '')
      .split('\n')
      .map((line) => line.replace(/^\s*\*\s?/, ''))
      .join('\n')
  );
}

function getRawJsDocForNode(node, sourceFile) {
  const nodeStart = node.getStart(sourceFile);
  const ranges = ts.getLeadingCommentRanges(sourceFile.text, node.pos) || [];
  for (let i = ranges.length - 1; i >= 0; i--) {
    const range = ranges[i];
    if (range.kind !== ts.SyntaxKind.MultiLineCommentTrivia) {
      continue;
    }
    const raw = sourceFile.text.slice(range.pos, range.end);
    if (!raw.startsWith('/**')) {
      continue;
    }
    const gap = sourceFile.text.slice(range.end, nodeStart);
    if (/\S/.test(gap)) {
      continue;
    }
    return cleanJsDocBlock(raw);
  }
  return '';
}

function getJsDocStartPosition(node, sourceFile) {
  const nodeStart = node.getStart(sourceFile);
  const ranges = ts.getLeadingCommentRanges(sourceFile.text, node.pos) || [];
  for (let i = ranges.length - 1; i >= 0; i--) {
    const range = ranges[i];
    if (range.kind !== ts.SyntaxKind.MultiLineCommentTrivia) {
      continue;
    }
    const raw = sourceFile.text.slice(range.pos, range.end);
    if (!raw.startsWith('/**')) {
      continue;
    }
    const gap = sourceFile.text.slice(range.end, nodeStart);
    if (/\S/.test(gap)) {
      continue;
    }
    return range.pos;
  }
  return nodeStart;
}

function getSignaturePreview(node, sourceFile) {
  const text = sourceFile.text.slice(node.getStart(sourceFile), node.getEnd()).replace(/\r/g, '');
  const firstLines = text.split('\n').slice(0, 8).join('\n');
  return limitText(normalizeWhitespace(firstLines), 320);
}

function getLineRange(node, sourceFile) {
  const start = sourceFile.getLineAndCharacterOfPosition(getJsDocStartPosition(node, sourceFile));
  const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
  return {
    startLine: start.line + 1,
    endLine: end.line + 1
  };
}

function addEntry(entryMap, entry) {
  const key = [
    entry.package,
    entry.path,
    entry.symbol,
    entry.containerSymbol || '',
    entry.kind
  ].join('|');
  const existing = entryMap.get(key);
  if (existing) {
    existing.startLine = Math.min(existing.startLine, entry.startLine);
    existing.endLine = Math.max(existing.endLine, entry.endLine);
    if (entry.docs && !existing.docs) {
      existing.docs = entry.docs;
    }
    if (entry.signature && !existing.signature.includes(entry.signature)) {
      existing.signature = limitText(`${existing.signature}\n${entry.signature}`.trim(), 640);
    }
    existing.searchText = limitText(
      `${existing.searchText}\n${entry.searchText}`.trim(),
      4000
    );
    existing.keywords = [...new Set([...existing.keywords, ...entry.keywords])].slice(0, 128);
    return;
  }
  entryMap.set(key, entry);
}

function buildStableEntryId(entry) {
  return [entry.package, entry.kind, entry.path, entry.symbol].join(':');
}

function collectDeclarationEntry(entryMap, checker, sourceFile, packageName, relativePath, node, kind, containerSymbol) {
  const localName = getNodeName(node);
  if (!localName) {
    return;
  }
  const symbol = checker.getSymbolAtLocation(node.name ?? node);
  const docs = getDocumentationForSymbol(symbol, checker);
  const jsDoc = getRawJsDocForNode(node, sourceFile);
  const signature = getSignaturePreview(node, sourceFile);
  const { startLine, endLine } = getLineRange(node, sourceFile);
  const symbolName = containerSymbol ? `${containerSymbol}.${localName}` : localName;
  const searchText = normalizeWhitespace(
    [symbolName, signature, docs, jsDoc, relativePath, packageName, kind].filter(Boolean).join('\n')
  );
  addEntry(entryMap, {
    id: buildStableEntryId({
      package: packageName,
      kind,
      path: relativePath,
      symbol: symbolName
    }),
    package: packageName,
    path: relativePath,
    symbol: symbolName,
    localName,
    containerSymbol: containerSymbol || '',
    kind,
    signature,
    docs,
    jsDoc,
    startLine,
    endLine,
    searchText,
    keywords: tokenize(searchText)
  });
}

function visitTopLevelNode(entryMap, checker, sourceFile, packageName, relativePath, node) {
  if (ts.isFunctionDeclaration(node) && node.name) {
    collectDeclarationEntry(entryMap, checker, sourceFile, packageName, relativePath, node, 'function', '');
    return;
  }
  if (ts.isClassDeclaration(node) && node.name) {
    const containerSymbol = getNodeName(node);
    collectDeclarationEntry(entryMap, checker, sourceFile, packageName, relativePath, node, 'class', '');
    for (const member of node.members) {
      if (
        ts.isMethodDeclaration(member) ||
        ts.isPropertyDeclaration(member) ||
        ts.isGetAccessorDeclaration(member) ||
        ts.isSetAccessorDeclaration(member) ||
        ts.isConstructorDeclaration(member)
      ) {
        collectDeclarationEntry(
          entryMap,
          checker,
          sourceFile,
          packageName,
          relativePath,
          member,
          ts.isConstructorDeclaration(member) ? 'constructor' : 'member',
          containerSymbol
        );
      }
    }
    return;
  }
  if (ts.isInterfaceDeclaration(node) && node.name) {
    const containerSymbol = getNodeName(node);
    collectDeclarationEntry(entryMap, checker, sourceFile, packageName, relativePath, node, 'interface', '');
    for (const member of node.members) {
      if (
        ts.isMethodSignature(member) ||
        ts.isPropertySignature(member) ||
        ts.isConstructSignatureDeclaration(member) ||
        ts.isCallSignatureDeclaration(member) ||
        ts.isIndexSignatureDeclaration(member)
      ) {
        collectDeclarationEntry(entryMap, checker, sourceFile, packageName, relativePath, member, 'member', containerSymbol);
      }
    }
    return;
  }
  if (ts.isTypeAliasDeclaration(node) && node.name) {
    collectDeclarationEntry(entryMap, checker, sourceFile, packageName, relativePath, node, 'type', '');
    return;
  }
  if (ts.isEnumDeclaration(node) && node.name) {
    const containerSymbol = getNodeName(node);
    collectDeclarationEntry(entryMap, checker, sourceFile, packageName, relativePath, node, 'enum', '');
    for (const member of node.members) {
      collectDeclarationEntry(entryMap, checker, sourceFile, packageName, relativePath, member, 'enum_member', containerSymbol);
    }
    return;
  }
  if (ts.isVariableStatement(node)) {
    for (const declaration of node.declarationList.declarations) {
      if (declaration.name && ts.isIdentifier(declaration.name)) {
        collectDeclarationEntry(entryMap, checker, sourceFile, packageName, relativePath, declaration, 'variable', '');
      }
    }
  }
}

async function main() {
  const declarationFiles = [];
  for (const packageName of packageNames) {
    const filePath = path.join(vendorRoot, packageName, 'dist', 'index.d.ts');
    try {
      await fs.access(filePath);
    } catch {
      throw new Error(`Missing declaration file: ${filePath}`);
    }
    declarationFiles.push(filePath);
  }

  const program = ts.createProgram(declarationFiles, {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    allowJs: false,
    skipLibCheck: true
  });
  const checker = program.getTypeChecker();
  const entryMap = new Map();

  for (const sourceFile of program.getSourceFiles()) {
    const normalizedFileName = path.resolve(sourceFile.fileName).replace(/\\/g, '/');
    if (!normalizedFileName.startsWith(vendorRootNormalized) || sourceFile.isDeclarationFile === false) {
      continue;
    }
    const relativePath = path.relative(vendorRoot, normalizedFileName).replace(/\\/g, '/');
    const packageName = relativePath.split('/')[0];
    if (!packageNames.includes(packageName)) {
      continue;
    }
    for (const statement of sourceFile.statements) {
      visitTopLevelNode(entryMap, checker, sourceFile, packageName, relativePath, statement);
    }
  }

  const entries = [...entryMap.values()]
    .sort((a, b) => a.symbol.localeCompare(b.symbol) || a.startLine - b.startLine)
    .map((entry) => ({
      ...entry,
      id: buildStableEntryId(entry)
    }));

  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(
    outputPath,
    `${JSON.stringify(
      {
        version: 1,
        generatedAt: new Date().toISOString(),
        vendorRoot: 'dist/vendor/zephyr3d',
        packages: packageNames,
        entries
      },
      null,
      2
    )}\n`,
    'utf8'
  );
  console.log(`Wrote ${entries.length} assistant type index entries to ${outputPath}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
