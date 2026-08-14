import type {
  FbxConnection,
  FbxDocument,
  FbxGlobalSettings,
  FbxNode,
  FbxObjectMap,
  FbxPropertyValue
} from './types';

const FBX_BINARY_MAGIC = 'Kaydara FBX Binary  \0';

function stripQuotes(text: string) {
  return text.length >= 2 && text[0] === '"' && text[text.length - 1] === '"' ? text.slice(1, -1) : text;
}

function toNumber(value: string) {
  if (/^[+-]?\d+$/.test(value)) {
    return Number.parseInt(value, 10);
  }
  return Number.parseFloat(value);
}

function splitAsciiProperties(text: string) {
  const result: string[] = [];
  let current = '';
  let inString = false;
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      inString = !inString;
      current += ch;
      continue;
    }
    if (!inString) {
      if (ch === '{' || ch === '[' || ch === '(') {
        depth++;
      } else if (ch === '}' || ch === ']' || ch === ')') {
        depth--;
      } else if (ch === ',' && depth === 0) {
        result.push(current.trim());
        current = '';
        continue;
      }
    }
    current += ch;
  }
  if (current.trim()) {
    result.push(current.trim());
  }
  return result;
}

function parseAsciiScalar(text: string): FbxPropertyValue {
  const trimmed = text.trim();
  if (!trimmed) {
    return '';
  }
  if (trimmed[0] === '"' && trimmed[trimmed.length - 1] === '"') {
    return stripQuotes(trimmed);
  }
  if (trimmed === 'Y' || trimmed === 'T') {
    return true;
  }
  if (trimmed === 'N' || trimmed === 'F') {
    return false;
  }
  if (trimmed[0] === '*' && trimmed.includes('{')) {
    const begin = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (begin >= 0 && end > begin) {
      const body = trimmed.slice(begin + 1, end);
      const colon = body.indexOf(':');
      const valuesText = colon >= 0 ? body.slice(colon + 1) : body;
      const tokens = splitAsciiProperties(valuesText);
      const values = tokens.map((token) => toNumber(token));
      return Float64Array.from(values);
    }
  }
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed) || /^[+-]?\d+$/.test(trimmed)) {
    return toNumber(trimmed);
  }
  return trimmed;
}

function parseAsciiNodeHeader(line: string) {
  const colon = line.indexOf(':');
  if (colon < 0) {
    return { name: line.trim(), properties: [] as FbxPropertyValue[] };
  }
  const name = line.slice(0, colon).trim();
  const propsText = line.slice(colon + 1).trim();
  const properties = propsText ? splitAsciiProperties(propsText).map(parseAsciiScalar) : [];
  return { name, properties };
}

function parseAscii(text: string): FbxNode {
  const root: FbxNode = {
    name: 'Root',
    properties: [],
    propertyListLength: 0,
    children: []
  };
  const stack: FbxNode[] = [root];
  const lines = text.split(/\r?\n/);
  for (let rawLine of lines) {
    const comment = rawLine.indexOf(';');
    if (comment >= 0) {
      rawLine = rawLine.slice(0, comment);
    }
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    if (line === '}') {
      if (stack.length > 1) {
        stack.pop();
      }
      continue;
    }
    if (line.endsWith('{')) {
      const header = line.slice(0, -1).trim();
      const { name, properties } = parseAsciiNodeHeader(header);
      const node: FbxNode = {
        name,
        properties,
        propertyListLength: 0,
        children: []
      };
      stack[stack.length - 1].children.push(node);
      stack.push(node);
      continue;
    }
    const { name, properties } = parseAsciiNodeHeader(line);
    stack[stack.length - 1].children.push({
      name,
      properties,
      propertyListLength: 0,
      children: []
    });
  }
  return root;
}

class BinaryReader {
  private readonly _view: DataView;
  private readonly _buffer: ArrayBuffer;
  private readonly _decoder: TextDecoder;
  private _offset: number;
  constructor(buffer: ArrayBuffer) {
    this._buffer = buffer;
    this._view = new DataView(buffer);
    this._decoder = new TextDecoder('utf-8');
    this._offset = 0;
  }
  get offset() {
    return this._offset;
  }
  set offset(value: number) {
    this._offset = value;
  }
  skip(bytes: number) {
    this._offset += bytes;
  }
  getUint8() {
    const value = this._view.getUint8(this._offset);
    this._offset += 1;
    return value;
  }
  getInt16() {
    const value = this._view.getInt16(this._offset, true);
    this._offset += 2;
    return value;
  }
  getInt32() {
    const value = this._view.getInt32(this._offset, true);
    this._offset += 4;
    return value;
  }
  getUint32() {
    const value = this._view.getUint32(this._offset, true);
    this._offset += 4;
    return value;
  }
  getFloat32() {
    const value = this._view.getFloat32(this._offset, true);
    this._offset += 4;
    return value;
  }
  getFloat64() {
    const value = this._view.getFloat64(this._offset, true);
    this._offset += 8;
    return value;
  }
  getBigInt64() {
    const value = this._view.getBigInt64(this._offset, true);
    this._offset += 8;
    return value;
  }
  getBoolean() {
    return this.getUint8() === 1;
  }
  getString(length: number) {
    const value = this._decoder.decode(new Uint8Array(this._buffer, this._offset, length));
    this._offset += length;
    return value.replace(/\0+$/, '');
  }
  getArrayBuffer(length: number) {
    const value = this._buffer.slice(this._offset, this._offset + length);
    this._offset += length;
    return value;
  }
}

async function inflateDeflate(data: Uint8Array, expectedLength: number) {
  if (typeof DecompressionStream !== 'undefined') {
    const stream = new Blob([
      data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
    ])
      .stream()
      .pipeThrough(new DecompressionStream('deflate'));
    const buffer = await new Response(stream).arrayBuffer();
    if (expectedLength > 0 && buffer.byteLength !== expectedLength) {
      console.warn(`FBX inflate length mismatch: expected=${expectedLength} actual=${buffer.byteLength}`);
    }
    return buffer;
  }
  throw new Error('Compressed FBX arrays are not supported in this runtime');
}

async function readArray(
  reader: BinaryReader,
  elementByteLength: number,
  arrayFactory: (buffer: ArrayBuffer) => ArrayBufferView
) {
  const length = reader.getUint32();
  const encoding = reader.getUint32();
  const compressedLength = reader.getUint32();
  if (encoding === 0) {
    const byteLength = length * elementByteLength;
    const buffer = reader.getArrayBuffer(byteLength);
    return arrayFactory(buffer);
  }
  const compressed = new Uint8Array(reader.getArrayBuffer(compressedLength));
  const buffer = await inflateDeflate(compressed, length * elementByteLength);
  return arrayFactory(buffer);
}

async function readBinaryProperty(reader: BinaryReader, type: string): Promise<FbxPropertyValue> {
  switch (type) {
    case 'C':
      return reader.getBoolean();
    case 'D':
      return reader.getFloat64();
    case 'F':
      return reader.getFloat32();
    case 'I':
      return reader.getInt32();
    case 'L':
      return reader.getBigInt64();
    case 'R': {
      const length = reader.getUint32();
      return reader.getArrayBuffer(length);
    }
    case 'S': {
      const length = reader.getUint32();
      return reader.getString(length);
    }
    case 'Y':
      return reader.getInt16();
    case 'b':
      return (await readArray(reader, 1, (buffer) => new Uint8Array(buffer))) as Uint8Array<ArrayBuffer>;
    case 'c':
      return (await readArray(reader, 1, (buffer) => new Uint8Array(buffer))) as Uint8Array<ArrayBuffer>;
    case 'd':
      return (await readArray(reader, 8, (buffer) => new Float64Array(buffer))) as Float64Array<ArrayBuffer>;
    case 'f':
      return (await readArray(reader, 4, (buffer) => new Float32Array(buffer))) as Float32Array<ArrayBuffer>;
    case 'i':
      return (await readArray(reader, 4, (buffer) => new Int32Array(buffer))) as Int32Array<ArrayBuffer>;
    case 'l':
      return (await readArray(
        reader,
        8,
        (buffer) => new BigInt64Array(buffer)
      )) as BigInt64Array<ArrayBuffer>;
    default:
      throw new Error(`Unsupported FBX property type: ${type}`);
  }
}

async function parseBinaryNode(reader: BinaryReader, version: number): Promise<FbxNode | null> {
  const use64 = version >= 7500;
  const endOffset = use64 ? Number(reader.getBigInt64()) : reader.getUint32();
  const numProperties = use64 ? Number(reader.getBigInt64()) : reader.getUint32();
  const propertyListLength = use64 ? Number(reader.getBigInt64()) : reader.getUint32();
  const nameLength = reader.getUint8();
  if (endOffset === 0 && numProperties === 0 && propertyListLength === 0 && nameLength === 0) {
    return null;
  }
  const name = reader.getString(nameLength);
  const properties: FbxPropertyValue[] = [];
  for (let i = 0; i < numProperties; i++) {
    properties.push(await readBinaryProperty(reader, String.fromCharCode(reader.getUint8())));
  }
  const node: FbxNode = {
    name,
    properties,
    propertyListLength,
    children: []
  };
  while (reader.offset < endOffset) {
    const child = await parseBinaryNode(reader, version);
    if (!child) {
      break;
    }
    node.children.push(child);
  }
  reader.offset = endOffset;
  return node;
}

function isBinaryFbx(buffer: ArrayBuffer) {
  const magic = new TextDecoder('ascii').decode(new Uint8Array(buffer, 0, FBX_BINARY_MAGIC.length));
  return magic === FBX_BINARY_MAGIC;
}

function getChild(node: FbxNode, name: string) {
  return node.children.find((child) => child.name === name) ?? null;
}

function getChildren(node: FbxNode, name: string) {
  return node.children.filter((child) => child.name === name);
}

function buildObjectMap(root: FbxNode): FbxObjectMap {
  const objectsNode = getChild(root, 'Objects');
  const map: FbxObjectMap = {};
  if (!objectsNode) {
    return map;
  }
  for (const child of objectsNode.children) {
    const id = child.properties[0];
    const idNumber = typeof id === 'bigint' ? Number(id) : typeof id === 'number' ? id : NaN;
    if (!Number.isFinite(idNumber)) {
      continue;
    }
    if (!map[child.name]) {
      map[child.name] = new Map();
    }
    map[child.name].set(idNumber, child);
  }
  return map;
}

function buildConnections(root: FbxNode): FbxConnection[] {
  const result: FbxConnection[] = [];
  const connectionsNode = getChild(root, 'Connections');
  if (!connectionsNode) {
    return result;
  }
  for (const child of getChildren(connectionsNode, 'C')) {
    const type = String(child.properties[0] ?? '');
    const from = Number(child.properties[1] ?? 0);
    const to = Number(child.properties[2] ?? 0);
    const property = child.properties.length > 3 ? String(child.properties[3]) : undefined;
    result.push({ type, from, to, property });
  }
  return result;
}

function getVersion(root: FbxNode) {
  const header = getChild(root, 'FBXHeaderExtension');
  const versionNode = header ? getChild(header, 'FBXVersion') : null;
  const version = Number(versionNode?.properties[0] ?? 0);
  return Number.isFinite(version) ? version : 0;
}

function getProperty70Scalar(node: FbxNode | null, propertyName: string) {
  const props70 = node ? getChild(node, 'Properties70') : null;
  if (!props70) {
    return null;
  }
  for (const prop of getChildren(props70, 'P')) {
    if (String(prop.properties[0] ?? '') !== propertyName) {
      continue;
    }
    const value = prop.properties[4];
    if (typeof value === 'bigint') {
      return Number(value);
    }
    if (typeof value === 'number') {
      return value;
    }
    return null;
  }
  return null;
}

function getGlobalSettings(root: FbxNode): FbxGlobalSettings {
  const globalSettings = getChild(root, 'GlobalSettings');
  const unitScaleFactor = getProperty70Scalar(globalSettings, 'UnitScaleFactor');
  return {
    unitScaleFactor: Number.isFinite(unitScaleFactor) ? (unitScaleFactor ?? undefined) : undefined
  };
}

export async function parseFbx(buffer: ArrayBuffer): Promise<FbxDocument> {
  let root: FbxNode;
  if (isBinaryFbx(buffer)) {
    const reader = new BinaryReader(buffer);
    reader.skip(FBX_BINARY_MAGIC.length);
    reader.skip(2);
    const version = reader.getUint32();
    root = {
      name: 'Root',
      properties: [],
      propertyListLength: 0,
      children: []
    };
    while (reader.offset < buffer.byteLength) {
      const node = await parseBinaryNode(reader, version);
      if (!node) {
        break;
      }
      root.children.push(node);
    }
  } else {
    root = parseAscii(new TextDecoder('utf-8').decode(buffer));
  }
  return {
    version: getVersion(root),
    root,
    objects: buildObjectMap(root),
    connections: buildConnections(root),
    globalSettings: getGlobalSettings(root)
  };
}
