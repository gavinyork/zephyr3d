#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { isMainThread, parentPort, workerData } from 'node:worker_threads';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const IPC_TRANSPORT = !isMainThread && workerData?.transport === 'ipc';
const DEFAULT_PORT = Number(process.env.EDITOR_MCP_PORT ?? workerData?.port ?? (IPC_TRANSPORT ? 0 : 47231));
const BRIDGE_TOKEN =
  process.env.EDITOR_MCP_TOKEN || workerData?.token || crypto.randomBytes(12).toString('hex');
const DEFAULT_EDITOR_URL =
  process.env.EDITOR_URL || workerData?.editorUrl || 'http://127.0.0.1:8000/dist/index.html';
const ASSISTANT_TYPE_INDEX_PATH = path.resolve(
  __dirname,
  '..',
  'dist',
  'assistant',
  'zephyr-types-index.json'
);
const ASSISTANT_TYPES_VENDOR_ROOT = path.resolve(__dirname, '..', 'dist', 'vendor', 'zephyr3d');
const ASSISTANT_TYPE_PACKAGES = ['base', 'device', 'scene', 'imgui', 'backend-webgl', 'backend-webgpu'];
const MAX_TYPE_FILE_LINES = 240;
let assistantTypeIndexPromise = null;

function tokenizeSearchText(value) {
  return String(value || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[^a-zA-Z0-9_]+/g, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

function normalizeSearchValue(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function scoreTypeEntry(entry, query, tokens) {
  const symbolLower = normalizeSearchValue(entry.symbol);
  const signatureLower = normalizeSearchValue(entry.signature);
  const docsLower = normalizeSearchValue(entry.docs);
  const jsDocLower = normalizeSearchValue(entry.jsDoc);
  let score = 0;
  if (symbolLower === query) {
    score += 120;
  } else if (symbolLower.endsWith(`.${query}`)) {
    score += 90;
  } else if (symbolLower.includes(query)) {
    score += 55;
  }
  if (signatureLower.includes(query)) {
    score += 24;
  }
  for (const token of tokens) {
    if (symbolLower.includes(token)) {
      score += 12;
    }
    if (entry.keywords?.includes(token)) {
      score += 8;
    }
    if (signatureLower.includes(token)) {
      score += 5;
    }
    if (docsLower.includes(token)) {
      score += 3;
    }
    if (jsDocLower.includes(token)) {
      score += 4;
    }
    if (entry.package === token) {
      score += 4;
    }
  }
  return score;
}

function summarizeTypeEntry(entry, score = undefined) {
  return {
    id: entry.id,
    package: entry.package,
    path: entry.path,
    symbol: entry.symbol,
    containerSymbol: entry.containerSymbol,
    kind: entry.kind,
    signature: entry.signature,
    docs: entry.docs,
    jsDoc: entry.jsDoc,
    startLine: entry.startLine,
    endLine: entry.endLine,
    score
  };
}

async function loadAssistantTypeIndex() {
  if (!assistantTypeIndexPromise) {
    assistantTypeIndexPromise = fs
      .readFile(ASSISTANT_TYPE_INDEX_PATH, 'utf8')
      .then((text) => JSON.parse(text))
      .catch((err) => {
        assistantTypeIndexPromise = null;
        throw new Error(
          `Bundled Zephyr3D type index is unavailable at ${ASSISTANT_TYPE_INDEX_PATH}: ${err instanceof Error ? err.message : String(err)}`
        );
      });
  }
  return await assistantTypeIndexPromise;
}

function resolveBundledTypeFile(packageName, relativePath) {
  const normalizedPackage = String(packageName || '').trim();
  if (!ASSISTANT_TYPE_PACKAGES.includes(normalizedPackage)) {
    throw new Error(`Unsupported type package: ${normalizedPackage}`);
  }
  const normalizedRelativePath = String(relativePath || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
  if (!normalizedRelativePath) {
    throw new Error('Type file path is required');
  }
  const candidate = path.resolve(ASSISTANT_TYPES_VENDOR_ROOT, normalizedRelativePath);
  const packageRoot = path.resolve(ASSISTANT_TYPES_VENDOR_ROOT, normalizedPackage);
  if (!candidate.startsWith(`${packageRoot}${path.sep}`) || path.extname(candidate) !== '.ts') {
    throw new Error(`Invalid type file path: ${normalizedRelativePath}`);
  }
  return candidate;
}

async function readBundledTypeFileExcerpt(packageName, relativePath, startLine, endLine) {
  const filePath = resolveBundledTypeFile(packageName, relativePath);
  const text = await fs.readFile(filePath, 'utf8');
  const lines = text.replace(/\r/g, '').split('\n');
  const maxLine = lines.length;
  const normalizedStart = Math.max(1, Math.min(Number(startLine) || 1, maxLine));
  const normalizedEnd = Math.max(
    normalizedStart,
    Math.min(Number(endLine) || normalizedStart + MAX_TYPE_FILE_LINES - 1, maxLine)
  );
  const actualEnd = Math.min(normalizedEnd, normalizedStart + MAX_TYPE_FILE_LINES - 1);
  return {
    package: packageName,
    path: relativePath,
    filePath,
    totalLines: maxLine,
    startLine: normalizedStart,
    endLine: actualEnd,
    truncated: actualEnd < normalizedEnd,
    content: lines.slice(normalizedStart - 1, actualEnd).join('\n')
  };
}

function findTypeEntryByReference(index, reference, packageName) {
  const normalizedReference = String(reference || '').trim();
  if (!normalizedReference) {
    return null;
  }
  const filtered = index.entries.filter(
    (entry) =>
      (!packageName || entry.package === packageName) &&
      (entry.id === normalizedReference || entry.symbol === normalizedReference)
  );
  if (!filtered.length) {
    return null;
  }
  return filtered.sort(
    (a, b) => (a.symbol === normalizedReference ? -1 : 0) - (b.symbol === normalizedReference ? -1 : 0)
  )[0];
}

class EditorBridgeServer {
  constructor(port, token) {
    this.port = port;
    this.token = token;
    this.server = net.createServer((socket) => this.handleSocket(socket));
    this.client = null;
    this.clientInfo = null;
    this.nextId = 1;
    this.pending = new Map();
    this.waiters = [];
  }

  listen() {
    return new Promise((resolve, reject) => {
      const onError = (err) => {
        if (err?.code === 'EADDRINUSE' && this.port !== 0) {
          log(`Editor MCP preferred bridge port ${this.port} is in use; falling back to an ephemeral port.`);
          this.port = 0;
          this.server.listen(0, '127.0.0.1');
          return;
        }
        reject(err);
      };
      this.server.once('error', onError);
      this.server.listen(this.port, '127.0.0.1', () => {
        this.server.off('error', onError);
        const address = this.server.address();
        if (address && typeof address === 'object') {
          this.port = address.port;
        }
        resolve();
      });
    });
  }

  handleSocket(socket) {
    let handshake = Buffer.alloc(0);
    let websocketReady = false;
    let frameBuffer = Buffer.alloc(0);
    const fragmentedMessage = {
      opcode: 0,
      chunks: []
    };

    socket.on('data', (chunk) => {
      if (!websocketReady) {
        handshake = Buffer.concat([handshake, chunk]);
        const marker = handshake.indexOf('\r\n\r\n');
        if (marker < 0) {
          return;
        }
        const head = handshake.slice(0, marker).toString('utf8');
        const rest = handshake.slice(marker + 4);
        try {
          this.acceptWebSocket(socket, head);
          websocketReady = true;
          if (rest.length > 0) {
            frameBuffer = Buffer.concat([frameBuffer, rest]);
            frameBuffer = this.processFrames(socket, frameBuffer, fragmentedMessage);
          }
        } catch (err) {
          socket.destroy();
          log(`WebSocket handshake failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        return;
      }
      frameBuffer = Buffer.concat([frameBuffer, chunk]);
      frameBuffer = this.processFrames(socket, frameBuffer, fragmentedMessage);
    });

    socket.on('close', () => {
      if (this.client === socket) {
        this.client = null;
        this.clientInfo = null;
        for (const pending of this.pending.values()) {
          clearTimeout(pending.timer);
          pending.reject(new Error('Editor bridge disconnected'));
        }
        this.pending.clear();
      }
    });
  }

  acceptWebSocket(socket, head) {
    const lines = head.split('\r\n');
    const request = lines.shift() || '';
    if (!request.startsWith('GET /editor-mcp ')) {
      throw new Error(`unexpected request: ${request}`);
    }
    const headers = new Map();
    for (const line of lines) {
      const index = line.indexOf(':');
      if (index > 0) {
        headers.set(line.slice(0, index).trim().toLowerCase(), line.slice(index + 1).trim());
      }
    }
    const key = headers.get('sec-websocket-key');
    if (!key) {
      throw new Error('missing Sec-WebSocket-Key');
    }
    const accept = crypto
      .createHash('sha1')
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest('base64');
    socket.write(
      [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${accept}`,
        '',
        ''
      ].join('\r\n')
    );
  }

  processFrames(socket, buffer, fragmentedMessage) {
    let offset = 0;
    while (buffer.length - offset >= 2) {
      const first = buffer[offset];
      const second = buffer[offset + 1];
      const fin = (first & 0x80) !== 0;
      const opcode = first & 0x0f;
      const masked = (second & 0x80) !== 0;
      let length = second & 0x7f;
      let headerLength = 2;
      if (length === 126) {
        if (buffer.length - offset < 4) {
          break;
        }
        length = buffer.readUInt16BE(offset + 2);
        headerLength = 4;
      } else if (length === 127) {
        if (buffer.length - offset < 10) {
          break;
        }
        const high = buffer.readUInt32BE(offset + 2);
        const low = buffer.readUInt32BE(offset + 6);
        length = high * 2 ** 32 + low;
        headerLength = 10;
      }
      const maskLength = masked ? 4 : 0;
      const frameEnd = offset + headerLength + maskLength + length;
      if (buffer.length < frameEnd) {
        break;
      }
      let payload = buffer.slice(offset + headerLength + maskLength, frameEnd);
      if (masked) {
        const mask = buffer.slice(offset + headerLength, offset + headerLength + 4);
        payload = Buffer.from(payload.map((value, index) => value ^ mask[index % 4]));
      }
      offset = frameEnd;
      if (opcode === 0x8) {
        socket.end();
        continue;
      }
      if (opcode === 0x9) {
        socket.write(encodeWebSocketFrame(payload, 0x0a));
        continue;
      }
      if (opcode === 0x0) {
        if (!fragmentedMessage.opcode) {
          log('Ignoring unexpected WebSocket continuation frame without an active fragmented message.');
          continue;
        }
        fragmentedMessage.chunks.push(payload);
        if (fin) {
          const message = Buffer.concat(fragmentedMessage.chunks);
          const messageOpcode = fragmentedMessage.opcode;
          fragmentedMessage.opcode = 0;
          fragmentedMessage.chunks = [];
          if (messageOpcode === 0x1) {
            this.handleMessage(socket, message.toString('utf8'));
          }
        }
        continue;
      }
      if (opcode === 0x1) {
        if (!fin) {
          fragmentedMessage.opcode = opcode;
          fragmentedMessage.chunks = [payload];
          continue;
        }
        this.handleMessage(socket, payload.toString('utf8'));
      }
    }
    return buffer.slice(offset);
  }

  handleMessage(socket, text) {
    let msg;
    try {
      msg = JSON.parse(text);
    } catch (err) {
      log(`Invalid editor bridge JSON: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    if (msg.type === 'hello') {
      if (!tokenMatches(this.token, msg.token)) {
        log('Rejecting editor bridge connection with an invalid token.');
        socket.end();
        return;
      }
      if (this.client && this.client !== socket) {
        this.client.end();
      }
      this.client = socket;
      this.clientInfo = {
        href: msg.href ?? null,
        userAgent: msg.userAgent ?? null,
        connectedAt: new Date().toISOString()
      };
      for (const waiter of this.waiters.splice(0)) {
        waiter();
      }
      return;
    }
    if (Object.prototype.hasOwnProperty.call(msg, 'id')) {
      const pending = this.pending.get(msg.id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(msg.id);
        if (msg.error) {
          pending.reject(new Error(msg.error.message || String(msg.error)));
        } else {
          pending.resolve(msg.result);
        }
      }
    }
  }

  send(method, params, timeoutMs = 30000) {
    if (!this.client) {
      throw new Error(
        'No editor window is connected. Launch the Electron editor and wait for editor_wait_ready.'
      );
    }
    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params: params ?? {} });
    this.client.write(encodeWebSocketFrame(Buffer.from(payload, 'utf8'), 0x1));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Editor bridge call timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });
  }

  async waitForClient(timeoutMs = 30000) {
    if (this.client) {
      return this.clientInfo;
    }
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.waiters.indexOf(onReady);
        if (index >= 0) {
          this.waiters.splice(index, 1);
        }
        reject(new Error('Timed out waiting for editor page connection'));
      }, timeoutMs);
      const onReady = () => {
        clearTimeout(timer);
        resolve();
      };
      this.waiters.push(onReady);
    });
    return this.clientInfo;
  }

  getInfo() {
    return {
      port: this.port,
      token: this.token,
      connected: !!this.client,
      client: this.clientInfo
    };
  }

  async close() {
    const client = this.client;
    this.client = null;
    this.clientInfo = null;
    if (client && !client.destroyed) {
      client.destroy();
    }
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Editor bridge server is shutting down'));
    }
    this.pending.clear();
    for (const waiter of this.waiters.splice(0)) {
      waiter();
    }
    if (!this.server.listening) {
      return;
    }
    await new Promise((resolve) => {
      this.server.close(() => resolve());
    });
  }
}

function tokenMatches(expected, actual) {
  if (typeof expected !== 'string' || typeof actual !== 'string') {
    return false;
  }
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const actualBuffer = Buffer.from(actual, 'utf8');
  return (
    expectedBuffer.length === actualBuffer.length && crypto.timingSafeEqual(expectedBuffer, actualBuffer)
  );
}

function encodeWebSocketFrame(payload, opcode) {
  const length = payload.length;
  let header;
  if (length < 126) {
    header = Buffer.from([0x80 | opcode, length]);
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeUInt32BE(Math.floor(length / 2 ** 32), 2);
    header.writeUInt32BE(length >>> 0, 6);
  }
  return Buffer.concat([header, payload]);
}

const bridge = new EditorBridgeServer(DEFAULT_PORT, BRIDGE_TOKEN);
await bridge.listen();
log(`Editor MCP bridge listening on ws://127.0.0.1:${bridge.port}/editor-mcp`);
if (IPC_TRANSPORT) {
  parentPort?.postMessage({
    type: 'ready',
    bridge: bridge.getInfo()
  });
}

const MATERIAL_CLASSES = [
  'UnlitMaterial',
  'LambertMaterial',
  'BlinnMaterial',
  'PBRMetallicRoughnessMaterial',
  'PBRSpecularGlossinessMaterial',
  'StandardSpriteMaterial'
];

const UV_AXIS_VALUES = ['x', 'y', 'z', '-x', '-y', '-z'];
const POSITIVE_AXIS_VALUES = ['x', 'y', 'z'];
const UV_MODE_VALUES = ['default', 'normalized', 'worldLength', 'planar', 'box', 'cylindrical', 'spherical'];
const COORDINATE_SYSTEM_SCHEMA_VALUES = ['editor', 'y_up', 'z_up'];
const COORDINATE_REMAP_SCHEMA_VALUES = ['none', 'z_up_to_y_up', 'y_up_to_z_up'];
const SURFACE_TYPE_SCHEMA_VALUES = ['bezier_patch'];
const CURVE_TYPE_SCHEMA_VALUES = ['polyline', 'bezier', 'catmull_rom', 'nurbs'];
const SCRIPT_TARGET_VALUES = ['selected', 'scene', 'node'];
const SCRIPT_ATTACH_MODE_VALUES = ['replace_same_path', 'append', 'replace_all'];
const NODE_REPARENT_TRANSFORM_MODE_VALUES = ['preserve_world', 'preserve_local'];
const SCRIPT_CONFIG_SCHEMA = {
  oneOf: [{ type: 'object', additionalProperties: true }, { type: 'array', items: {} }, { type: 'null' }],
  description:
    'Optional JSON-serializable script config. Use an object for named scriptProp values or an array when the script expects one.'
};

function numberTupleSchema(length, description) {
  return {
    type: 'array',
    minItems: length,
    maxItems: length,
    items: { type: 'number' },
    description
  };
}

function integerSchema(minimum, maximum, description) {
  const schema = {
    type: 'integer',
    minimum
  };
  if (maximum !== undefined) {
    schema.maximum = maximum;
  }
  if (description) {
    schema.description = description;
  }
  return schema;
}

function numberSchema(options = {}) {
  const schema = {
    type: 'number'
  };
  if (options.minimum !== undefined) {
    schema.minimum = options.minimum;
  }
  if (options.maximum !== undefined) {
    schema.maximum = options.maximum;
  }
  if (options.exclusiveMinimum !== undefined) {
    schema.exclusiveMinimum = options.exclusiveMinimum;
  }
  if (options.description) {
    schema.description = options.description;
  }
  return schema;
}

function createCoordinateRemapSchema() {
  return {
    description:
      'Optional axis remap applied after coordinate_system. Use a preset string or explicit axis mapping.',
    oneOf: [
      {
        type: 'string',
        enum: COORDINATE_REMAP_SCHEMA_VALUES
      },
      {
        type: 'object',
        properties: {
          axes: {
            type: 'array',
            minItems: 3,
            maxItems: 3,
            items: { type: 'string', enum: UV_AXIS_VALUES },
            description: 'Explicit X/Y/Z source axes, for example ["x", "z", "-y"].'
          }
        },
        required: ['axes']
      }
    ]
  };
}

function createUvSpecSchema() {
  return {
    type: 'object',
    description: 'Optional UV generation and remapping settings for generated vertices.',
    properties: {
      mode: {
        type: 'string',
        enum: UV_MODE_VALUES,
        description: 'UV generation mode.'
      },
      axes: {
        type: 'array',
        minItems: 2,
        maxItems: 2,
        items: { type: 'string', enum: UV_AXIS_VALUES },
        description: 'U/V source axes, for example ["x", "z"].'
      },
      axis: {
        type: 'string',
        enum: POSITIVE_AXIS_VALUES,
        description: 'Primary positive axis for cylindrical or spherical mapping.'
      },
      origin: numberTupleSchema(3, 'Mapping origin as [x, y, z].'),
      size: numberTupleSchema(2, 'Planar or box mapping size as [width, height].'),
      tile_size: numberTupleSchema(2, 'World-space tiling size as [u, v].'),
      scale: numberTupleSchema(2, 'UV scale as [u, v].'),
      offset: numberTupleSchema(2, 'UV offset as [u, v].'),
      flip_u: { type: 'boolean' },
      flip_v: { type: 'boolean' },
      swap_uv: { type: 'boolean' },
      repeat: numberTupleSchema(2, 'Repeat multiplier as [u, v].')
    }
  };
}

function createBaseNodeProperties() {
  return {
    id: {
      type: 'string',
      description: 'Optional caller-defined node identifier for your own bookkeeping.'
    },
    coordinate_system: {
      type: 'string',
      enum: COORDINATE_SYSTEM_SCHEMA_VALUES,
      description: 'Coordinate system used by this node before coordinate_remap is applied.'
    },
    coordinate_remap: createCoordinateRemapSchema(),
    position: numberTupleSchema(3, 'Optional local translation as [x, y, z].'),
    rotation: numberTupleSchema(4, 'Optional local rotation quaternion as [x, y, z, w].'),
    scale: numberTupleSchema(3, 'Optional local scale as [x, y, z].'),
    preserve_winding: {
      type: 'boolean',
      description: 'When true, keep triangle winding exactly as generated instead of auto-matching normals.'
    },
    uv: createUvSpecSchema()
  };
}

function createBoxNodeSchema() {
  return {
    type: 'object',
    description: 'Axis-aligned box primitive.',
    properties: {
      ...createBaseNodeProperties(),
      type: { type: 'string', enum: ['box'] },
      size: numberTupleSchema(3, 'Optional box size as [x, y, z]. Defaults to [1, 1, 1].')
    },
    required: ['type']
  };
}

function createCylinderNodeSchema() {
  return {
    type: 'object',
    description: 'Cylinder primitive with capped top and bottom.',
    properties: {
      ...createBaseNodeProperties(),
      type: { type: 'string', enum: ['cylinder'] },
      radius: numberSchema({ exclusiveMinimum: 0, description: 'Cylinder radius. Defaults to 0.5.' }),
      height: numberSchema({ exclusiveMinimum: 0, description: 'Cylinder height. Defaults to 1.' }),
      segments: integerSchema(3, 512, 'Radial segment count. Defaults to 32.')
    },
    required: ['type']
  };
}

function createSphereNodeSchema() {
  return {
    type: 'object',
    description: 'UV sphere primitive.',
    properties: {
      ...createBaseNodeProperties(),
      type: { type: 'string', enum: ['sphere'] },
      radius: numberSchema({ exclusiveMinimum: 0, description: 'Sphere radius. Defaults to 0.5.' }),
      width_segments: integerSchema(3, 512, 'Horizontal segment count. Defaults to 32.'),
      height_segments: integerSchema(2, 256, 'Vertical segment count. Defaults to 16.')
    },
    required: ['type']
  };
}

function createRevolveNodeSchema() {
  return {
    type: 'object',
    description: 'Surface of revolution built from a [radius, height] profile.',
    properties: {
      ...createBaseNodeProperties(),
      type: { type: 'string', enum: ['revolve'] },
      profile: {
        type: 'array',
        minItems: 2,
        items: numberTupleSchema(2, 'Profile point as [radius, height]. Radius must be non-negative.'),
        description: 'Ordered profile points, each as [radius, height].'
      },
      segments: integerSchema(3, 1024, 'Revolution segment count. Defaults to 64.'),
      cap_top: { type: 'boolean' },
      cap_bottom: { type: 'boolean' }
    },
    required: ['type', 'profile']
  };
}

function createSurfacePatchSchema() {
  return {
    description: 'Bezier patch definition using 16 indices, 16 inline points, or a patch object.',
    oneOf: [
      {
        type: 'array',
        minItems: 16,
        maxItems: 16,
        items: { type: 'integer', minimum: 0 },
        description: 'Sixteen control point indices into control_points.'
      },
      {
        type: 'array',
        minItems: 16,
        maxItems: 16,
        items: numberTupleSchema(3, 'Inline control point as [x, y, z].'),
        description: 'Sixteen inline control points.'
      },
      {
        type: 'object',
        properties: {
          indices: {
            type: 'array',
            minItems: 16,
            maxItems: 16,
            items: { type: 'integer', minimum: 0 },
            description: 'Sixteen control point indices into control_points.'
          },
          points: {
            type: 'array',
            minItems: 16,
            maxItems: 16,
            items: numberTupleSchema(3, 'Inline control point as [x, y, z].'),
            description: 'Sixteen inline control points.'
          },
          mirror: numberTupleSchema(3, 'Per-axis mirror multiplier, for example [-1, 1, 1].'),
          reverse_u: { type: 'boolean' },
          reverse_v: { type: 'boolean' },
          flip_winding: { type: 'boolean' },
          flip_normals: { type: 'boolean' }
        },
        anyOf: [{ required: ['indices'] }, { required: ['points'] }]
      }
    ]
  };
}

function createSurfaceNodeSchema() {
  return {
    type: 'object',
    description: 'Bezier patch surface assembled from one or more bicubic patches.',
    properties: {
      ...createBaseNodeProperties(),
      type: { type: 'string', enum: ['surface'] },
      surface_type: {
        type: 'string',
        enum: SURFACE_TYPE_SCHEMA_VALUES,
        description: 'Surface implementation. Only bezier_patch is currently supported.'
      },
      control_points: {
        type: 'array',
        minItems: 1,
        items: numberTupleSchema(3, 'Control point as [x, y, z].'),
        description: 'Shared control points referenced by patch indices.'
      },
      patches: {
        type: 'array',
        minItems: 1,
        items: createSurfacePatchSchema(),
        description: 'One or more bicubic Bezier patches.'
      },
      segments_u: integerSchema(1, 256, 'Subdivision count in the U direction. Defaults to 16.'),
      segments_v: integerSchema(1, 256, 'Subdivision count in the V direction. Defaults to segments_u.'),
      flip_winding: { type: 'boolean' },
      flip_normals: { type: 'boolean' },
      normal_orientation: {
        type: 'string',
        enum: ['patch', 'outward', 'inward'],
        description: 'Normal orientation strategy after tessellation.'
      },
      smooth_seams: { type: 'boolean' },
      seam_tolerance: numberSchema({
        exclusiveMinimum: 0,
        description: 'Normal welding tolerance for shared vertices. Defaults to 1e-5.'
      }),
      double_sided: { type: 'boolean' },
      backface_offset: numberSchema({
        minimum: 0,
        description: 'Optional inward offset applied when duplicating backfaces.'
      })
    },
    required: ['type', 'patches']
  };
}

function createCurveNodeSchema() {
  return {
    type: 'object',
    description: 'Curve-driven ribbon or tube mesh.',
    properties: {
      ...createBaseNodeProperties(),
      type: { type: 'string', enum: ['curve'] },
      curve_type: {
        type: 'string',
        enum: CURVE_TYPE_SCHEMA_VALUES,
        description:
          'Curve interpolation mode. Use catmull_rom for Catmull-Rom splines. Defaults to polyline.'
      },
      shape: {
        type: 'string',
        enum: ['tube', 'ribbon'],
        description: 'Generated geometry style. Defaults to tube.'
      },
      points: {
        type: 'array',
        minItems: 2,
        items: numberTupleSchema(3, 'Curve control point as [x, y, z].'),
        description: 'Curve control points.'
      },
      degree: integerSchema(1, undefined, 'NURBS degree. Defaults to 3 when curve_type is nurbs.'),
      knots: {
        type: 'array',
        minItems: 2,
        items: { type: 'number' },
        description: 'Optional NURBS knot vector.'
      },
      weights: {
        type: 'array',
        minItems: 1,
        items: numberSchema({ exclusiveMinimum: 0 }),
        description: 'Optional positive NURBS weights.'
      },
      radius: numberSchema({ exclusiveMinimum: 0, description: 'Tube radius. Defaults to 0.05.' }),
      radii: {
        type: 'array',
        minItems: 1,
        items: numberSchema({ exclusiveMinimum: 0 }),
        description: 'Optional per-sample tube radii.'
      },
      width: numberSchema({ exclusiveMinimum: 0, description: 'Ribbon width. Defaults to 1.' }),
      widths: {
        type: 'array',
        minItems: 1,
        items: numberSchema({ exclusiveMinimum: 0 }),
        description: 'Optional per-sample ribbon widths.'
      },
      thickness: numberSchema({ minimum: 0, description: 'Ribbon thickness. Defaults to 0.' }),
      thicknesses: {
        type: 'array',
        minItems: 1,
        items: numberSchema({ minimum: 0 }),
        description: 'Optional per-sample ribbon thickness values.'
      },
      up: numberTupleSchema(3, 'Preferred ribbon up direction as [x, y, z].'),
      radial_segments: integerSchema(3, 128, 'Tube radial segment count. Defaults to 12.'),
      tubular_segments: integerSchema(1, 512, 'Sampling density along the curve. Defaults to 16.'),
      closed: { type: 'boolean' },
      cap_start: { type: 'boolean' },
      cap_end: { type: 'boolean' }
    },
    required: ['type', 'points']
  };
}

function createMeshNodeSchema() {
  return {
    type: 'object',
    description: 'Explicit triangle mesh. Use when primitives, curves, or patches are insufficient.',
    properties: {
      ...createBaseNodeProperties(),
      type: { type: 'string', enum: ['mesh'] },
      positions: {
        type: 'array',
        minItems: 1,
        items: numberTupleSchema(3, 'Vertex position as [x, y, z].'),
        description: 'Vertex positions.'
      },
      normals: {
        type: 'array',
        minItems: 1,
        items: numberTupleSchema(3, 'Vertex normal as [x, y, z].'),
        description: 'Optional vertex normals. Must match positions length when provided.'
      },
      uvs: {
        type: 'array',
        minItems: 1,
        items: numberTupleSchema(2, 'Vertex UV as [u, v].'),
        description: 'Optional vertex UVs. Must match positions length when provided.'
      },
      indices: {
        type: 'array',
        minItems: 3,
        items: { type: 'integer', minimum: 0 },
        description: 'Triangle indices into positions.'
      }
    },
    required: ['type', 'positions', 'indices']
  };
}

function createScriptNodeSchema() {
  return {
    type: 'object',
    description:
      'Execute a restricted local JavaScript generator that returns triangle mesh data. Use this when built-in primitives, curves, surfaces, CSG, and explicit mesh arrays are not ergonomic enough.',
    properties: {
      ...createBaseNodeProperties(),
      type: { type: 'string', enum: ['script'] },
      script: {
        type: 'object',
        description:
          'Restricted JavaScript. The script must define an entry function, defaulting to generate(api, input), and return either { positions, indices, normals?, uvs? } or api.mesh().build(). Available API: api.mesh(), api.math, api.assert(), api.check(), api.progress(). No network, filesystem, DOM, Node.js, eval, or dynamic imports are available.',
        properties: {
          language: {
            type: 'string',
            enum: ['javascript', 'js'],
            description: 'Script language. Omit or use javascript.'
          },
          entry: {
            type: 'string',
            description: 'Entry function name. Defaults to generate.'
          },
          source: {
            type: 'string',
            description: 'JavaScript source code executed inside the editor-side worker.'
          }
        },
        required: ['source']
      },
      input: {
        description: 'Optional JSON input object passed as the second argument to the script entry function.',
        oneOf: [
          { type: 'object', additionalProperties: true },
          { type: 'array', items: {} },
          { type: 'string' },
          { type: 'number' },
          { type: 'boolean' },
          { type: 'null' }
        ]
      }
    },
    required: ['type', 'script']
  };
}

function createCsgNodeSchema(depth) {
  const nestedNodeSchema = createProceduralNodeSchema(depth);
  return {
    type: 'object',
    description:
      'Constructive solid geometry node. Use children for union/intersection, or base + subtract for difference.',
    properties: {
      ...createBaseNodeProperties(),
      type: { type: 'string', enum: ['csg'] },
      op: {
        type: 'string',
        enum: ['union', 'difference', 'intersection', 'intersect'],
        description: 'Boolean operation. Use intersect as an alias of intersection if preferred.'
      },
      children: {
        type: 'array',
        minItems: 2,
        items: nestedNodeSchema,
        description: 'Operands for union or intersection.'
      },
      base: {
        ...nestedNodeSchema,
        description: 'Base operand for difference.'
      },
      subtract: {
        type: 'array',
        minItems: 1,
        items: nestedNodeSchema,
        description: 'Subtract operands for difference.'
      }
    },
    required: ['type', 'op'],
    anyOf: [{ required: ['children'] }, { required: ['base', 'subtract'] }]
  };
}

function createProceduralNodeSchema(depth = 2) {
  const variants = [
    createBoxNodeSchema(),
    createCylinderNodeSchema(),
    createSphereNodeSchema(),
    createRevolveNodeSchema(),
    createSurfaceNodeSchema(),
    createCurveNodeSchema(),
    createMeshNodeSchema(),
    createScriptNodeSchema()
  ];
  if (depth > 0) {
    variants.push(createCsgNodeSchema(depth - 1));
  }
  return {
    oneOf: variants
  };
}

const MODEL_GENERATE_BEGIN_EXAMPLES = [
  {
    spec: {
      version: 1,
      nodes: [
        {
          type: 'box',
          size: [1.6, 0.3, 1.6],
          position: [0, 0.15, 0],
          uv: {
            mode: 'box'
          }
        }
      ]
    },
    dest_path: '/assets/generated/pedestal.zmsh',
    name: 'Pedestal',
    create_node: true
  },
  {
    spec: {
      version: 1,
      generation: {
        max_vertices: 24000,
        generate_tangents: true
      },
      nodes: [
        {
          type: 'revolve',
          profile: [
            [0, 0],
            [0.18, 0],
            [0.42, 0.08],
            [0.34, 0.72],
            [0.2, 1.1],
            [0, 1.1]
          ],
          segments: 48,
          cap_bottom: true,
          uv: {
            mode: 'cylindrical',
            axis: 'y'
          }
        }
      ]
    },
    dest_path: '/assets/generated/vase.zmsh',
    name: 'Vase',
    create_node: true
  },
  {
    spec: {
      version: 1,
      generation: {
        max_vertices: 60000
      },
      nodes: [
        {
          type: 'csg',
          op: 'difference',
          base: {
            type: 'box',
            size: [2.4, 2.4, 0.6],
            position: [0, 1.2, 0]
          },
          subtract: [
            {
              type: 'curve',
              curve_type: 'catmull_rom',
              shape: 'tube',
              points: [
                [-0.95, 0, 0],
                [-0.45, 1.2, 0],
                [0.45, 1.2, 0],
                [0.95, 0, 0]
              ],
              radius: 0.24,
              tubular_segments: 32,
              radial_segments: 12
            }
          ]
        }
      ]
    },
    dest_path: '/assets/generated/arch_cutout.zmsh',
    name: 'ArchCutout',
    create_node: true
  },
  {
    spec: {
      version: 1,
      generation: {
        max_vertices: 40000,
        max_indices: 120000
      },
      nodes: [
        {
          type: 'script',
          input: {
            outer_radius: 0.7,
            inner_radius: 0.28,
            radial_segments: 32,
            tubular_segments: 20
          },
          script: {
            source: `function generate(api, input) {
  const mesh = api.mesh();
  const outer = input?.outer_radius ?? 0.7;
  const inner = input?.inner_radius ?? 0.28;
  const radialSegments = input?.radial_segments ?? 32;
  const tubularSegments = input?.tubular_segments ?? 20;
  for (let j = 0; j <= tubularSegments; j++) {
    const v = (j / tubularSegments) * api.math.TAU;
    const cv = api.math.cos(v);
    const sv = api.math.sin(v);
    for (let i = 0; i <= radialSegments; i++) {
      const u = (i / radialSegments) * api.math.TAU;
      const cu = api.math.cos(u);
      const su = api.math.sin(u);
      const center = [outer * cu, outer * su, 0];
      const normal = [cu * cv, su * cv, sv];
      const position = [
        (outer + inner * cv) * cu,
        (outer + inner * cv) * su,
        inner * sv
      ];
      mesh.addVertex(position, normal, [i / radialSegments, j / tubularSegments]);
    }
    api.progress((j + 1) / (tubularSegments + 1));
  }
  const stride = radialSegments + 1;
  for (let j = 0; j < tubularSegments; j++) {
    for (let i = 0; i < radialSegments; i++) {
      const a = j * stride + i;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      mesh.addTriangle(a, b, d);
      mesh.addTriangle(a, d, c);
    }
  }
  return mesh.build();
}`
          }
        }
      ]
    },
    dest_path: '/assets/generated/script_torus.zmsh',
    name: 'ScriptTorus',
    create_node: true
  }
];

const GENERATED_MODEL_SPEC_SCHEMA = {
  type: 'object',
  description:
    'Procedural model spec. Prefer built-in primitives, revolve, surface, curve, and csg before falling back to raw mesh buffers. See examples for a pedestal box, a revolve vase, and a CSG arch cutout.',
  properties: {
    version: {
      type: 'integer',
      enum: [1],
      description: 'Optional spec version. Omit or set to 1.'
    },
    generation: {
      type: 'object',
      properties: {
        max_vertices: integerSchema(
          1,
          undefined,
          'Abort generation when the resulting mesh exceeds this vertex count.'
        ),
        max_indices: integerSchema(
          3,
          undefined,
          'Abort generation when the resulting triangle-list index buffer exceeds this index count.'
        ),
        generate_tangents: {
          type: 'boolean',
          description: 'Generate tangent_f32x4 data for normal mapped materials.'
        },
        tangents: {
          type: 'boolean',
          description: 'Alias of generate_tangents.'
        }
      }
    },
    nodes: {
      type: 'array',
      minItems: 1,
      items: createProceduralNodeSchema(2),
      description: 'Top-level procedural nodes merged into a single generated mesh.'
    }
  },
  required: ['nodes'],
  examples: MODEL_GENERATE_BEGIN_EXAMPLES.map((example) => example.spec)
};

const BASE_TOOLS = [
  {
    name: 'editor_connect_info',
    description: 'Return the URL that opens the editor with the MCP bridge enabled.',
    inputSchema: {
      type: 'object',
      properties: {
        base_url: {
          type: 'string',
          description: 'Editor URL, defaulting to EDITOR_URL or local web-dev-server.'
        },
        device: { type: 'string', description: 'Optional renderer query value such as webgl2 or webgpu.' },
        project: { type: 'string', description: 'Optional project id/path query value.' },
        remote: { type: 'boolean', description: 'Set the editor remote project flag.' },
        open: { type: 'boolean', description: 'Set the editor open project flag.' }
      }
    }
  },
  {
    name: 'editor_wait_ready',
    description: 'Wait until the Electron editor window connects to this MCP server.',
    inputSchema: {
      type: 'object',
      properties: {
        timeout_ms: { type: 'number', default: 30000 }
      }
    }
  },
  {
    name: 'editor_status',
    description: 'Get editor, project, scene, canvas, and device status.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'docs_search_types',
    description:
      'Search the bundled Zephyr3D TypeScript declaration index for APIs, classes, functions, methods, types, and runtime scripting helpers.',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: {
          type: 'string',
          description: 'Search query such as RuntimeScript, SceneNode attach script, or PerspectiveCamera.'
        },
        package: {
          type: 'string',
          enum: ASSISTANT_TYPE_PACKAGES,
          description: 'Optional package filter such as scene or base.'
        },
        limit: {
          type: 'number',
          default: 5,
          description: 'Maximum number of matching declaration entries to return.'
        }
      }
    }
  },
  {
    name: 'docs_get_type_symbol',
    description:
      'Return declaration details for a bundled Zephyr3D type entry by id or symbol, including a source excerpt from the packaged .d.ts file.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Exact entry id returned by docs_search_types.'
        },
        symbol: {
          type: 'string',
          description: 'Exact symbol name such as RuntimeScript, SceneNode, or RuntimeScript.onStart.'
        },
        package: {
          type: 'string',
          enum: ASSISTANT_TYPE_PACKAGES,
          description: 'Optional package filter when resolving symbol names.'
        },
        max_lines: {
          type: 'number',
          default: 160,
          description: 'Optional maximum number of source lines to include in the excerpt.'
        }
      }
    }
  },
  {
    name: 'docs_read_type_file',
    description: 'Read a packaged Zephyr3D declaration file excerpt by package, path, and line range.',
    inputSchema: {
      type: 'object',
      required: ['package', 'path'],
      properties: {
        package: {
          type: 'string',
          enum: ASSISTANT_TYPE_PACKAGES,
          description: 'Package name such as scene or base.'
        },
        path: {
          type: 'string',
          description:
            'Relative declaration path returned by docs_search_types, such as scene/dist/index.d.ts.'
        },
        start_line: {
          type: 'number',
          description: '1-based start line. Defaults to 1.'
        },
        end_line: {
          type: 'number',
          description: `1-based end line. Excerpts are capped to ${MAX_TYPE_FILE_LINES} lines.`
        }
      }
    }
  },
  {
    name: 'project_list',
    description:
      'List editor projects. Returns projects as an array of { name, id } on success, otherwise returns err with the failure reason.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'project_get_current',
    description:
      'Get the currently opened editor project. Returns projectInfo with name and id when a project is open, otherwise returns err with the reason.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'project_create',
    description:
      'Create a new editor project with the given name and open it. Returns id with the new project id on success, or null id and err on failure.',
    inputSchema: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string', description: 'Name for the new project.' },
        path: {
          type: 'string',
          description:
            'Optional absolute directory path for the new project. In Electron this bypasses the native folder picker.'
        },
        save_scene_changes: {
          type: 'boolean',
          description:
            'Save the current dirty scene before creating the project. Fails if the scene has no path.'
        },
        discard_scene_changes: {
          type: 'boolean',
          description: 'Discard current dirty scene changes before creating the project.'
        },
        timeout_ms: { type: 'number', default: 30000 }
      }
    }
  },
  {
    name: 'project_open',
    description:
      'Open an existing editor project by project id. Returns id with the opened project id on success, or null id and err on failure.',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: {
        id: {
          type: 'string',
          description: 'Project id to open. In Electron this may be an absolute directory path.'
        },
        save_scene_changes: {
          type: 'boolean',
          description:
            'Save the current dirty scene before opening the project. Fails if the scene has no path.'
        },
        discard_scene_changes: {
          type: 'boolean',
          description: 'Discard current dirty scene changes before opening the project.'
        },
        timeout_ms: { type: 'number', default: 30000 }
      }
    }
  },
  {
    name: 'project_close',
    description:
      'Close the currently opened editor project. Returns err as null on success, otherwise err contains the failure reason.',
    inputSchema: {
      type: 'object',
      properties: {
        save_scene_changes: {
          type: 'boolean',
          description:
            'Save the current dirty scene before closing the project. Fails if the scene has no path.'
        },
        discard_scene_changes: {
          type: 'boolean',
          description: 'Discard current dirty scene changes before closing the project.'
        },
        timeout_ms: { type: 'number', default: 30000 }
      }
    }
  },
  {
    name: 'project_export',
    description:
      'Export the currently opened editor project. Requires a current project. Returns err as null on success, otherwise err contains the failure reason.',
    inputSchema: {
      type: 'object',
      properties: {
        save_scene_changes: {
          type: 'boolean',
          description:
            'Save the current dirty scene before exporting the project. Fails if the scene has no path.'
        },
        discard_scene_changes: {
          type: 'boolean',
          description: 'Export without saving current dirty scene changes.'
        },
        timeout_ms: { type: 'number', default: 60000 }
      }
    }
  },
  {
    name: 'project_delete',
    description:
      'Delete the currently opened editor project. Requires a current project. Returns err as null on success, otherwise err contains the failure reason.',
    inputSchema: {
      type: 'object',
      properties: {
        save_scene_changes: {
          type: 'boolean',
          description:
            'Save the current dirty scene before deleting the project. Fails if the scene has no path.'
        },
        discard_scene_changes: {
          type: 'boolean',
          description: 'Discard current dirty scene changes before deleting the project.'
        },
        timeout_ms: { type: 'number', default: 30000 }
      }
    }
  },
  {
    name: 'asset_get_root',
    description: 'Get the project asset root directory. Returns { root, err }.',
    inputSchema: {
      type: 'object',
      properties: {
        timeout_ms: { type: 'number', default: 10000 }
      }
    }
  },
  {
    name: 'asset_get_builtin_primitives',
    description:
      'List built-in primitive assets. These built-in primitives are read-only references under /assets/@builtins/primitives and cannot be modified in place. Returns { primitive_list, err }.',
    inputSchema: {
      type: 'object',
      properties: {
        timeout_ms: { type: 'number', default: 10000 }
      }
    }
  },
  {
    name: 'asset_get_builtin_materials',
    description:
      'List built-in material assets. These built-in materials are read-only references under /assets/@builtins/materials and cannot be modified in place. If you need to change material properties, first clone the material with asset_clone_material, then edit the cloned asset. Returns { material_list, err }.',
    inputSchema: {
      type: 'object',
      properties: {
        timeout_ms: { type: 'number', default: 10000 }
      }
    }
  },
  {
    name: 'asset_read_directory',
    description:
      'Read entries from a project asset directory. Supports optional recursive traversal and glob pattern filtering.',
    inputSchema: {
      type: 'object',
      required: ['path'],
      properties: {
        path: { type: 'string', description: 'VFS directory path, such as /assets or /assets/materials.' },
        recursive: { type: 'boolean', description: 'Read directories recursively when true.' },
        pattern: { type: 'string', description: 'Optional VFS glob pattern filter.' },
        timeout_ms: { type: 'number', default: 10000 }
      }
    }
  },
  {
    name: 'script_get_context',
    description:
      'Get the current scripting target context, including current project, current scene, selected nodes, resolved host (scene or node), current script attachments, and Zephyr3D scripting conventions.',
    inputSchema: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          enum: SCRIPT_TARGET_VALUES,
          description:
            'Target host resolution mode. selected resolves the current selection, treating the scene root selection as the scene host.'
        },
        node_id: {
          type: 'string',
          description: 'Required only when target is node. Persistent id of the scene node.'
        },
        timeout_ms: { type: 'number', default: 10000 }
      }
    }
  },
  {
    name: 'script_list_attachments',
    description:
      'List script attachments for a scene or scene node host. Use target=selected to inspect the current editor selection.',
    inputSchema: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          enum: SCRIPT_TARGET_VALUES,
          description:
            'Target host resolution mode. selected resolves the current selection, treating the scene root selection as the scene host.'
        },
        node_id: {
          type: 'string',
          description: 'Required only when target is node. Persistent id of the scene node.'
        },
        timeout_ms: { type: 'number', default: 10000 }
      }
    }
  },
  {
    name: 'script_read_source',
    description: 'Read a TypeScript or JavaScript script asset under /assets and return its text source.',
    inputSchema: {
      type: 'object',
      required: ['path'],
      properties: {
        path: { type: 'string', description: 'Script asset VFS path under /assets, ending in .ts or .js.' },
        timeout_ms: { type: 'number', default: 10000 }
      }
    }
  },
  {
    name: 'script_write_source',
    description:
      'Create or overwrite a TypeScript or JavaScript script asset under /assets. Parent directories are created automatically when needed.',
    inputSchema: {
      type: 'object',
      required: ['path', 'content'],
      properties: {
        path: {
          type: 'string',
          description: 'Writable script asset VFS path under /assets, ending in .ts or .js.'
        },
        content: { type: 'string', description: 'Full UTF-8 script source code.' },
        overwrite: {
          type: 'boolean',
          description: 'When false, fail if the destination script already exists. Defaults to true.'
        },
        timeout_ms: { type: 'number', default: 10000 }
      }
    }
  },
  {
    name: 'script_diagnostics',
    description:
      'Run TypeScript or JavaScript diagnostics for a script asset under /assets and return structured errors and warnings with line and column information.',
    inputSchema: {
      type: 'object',
      required: ['path'],
      properties: {
        path: { type: 'string', description: 'Script asset VFS path under /assets, ending in .ts or .js.' },
        timeout_ms: { type: 'number', default: 10000 }
      }
    }
  },
  /*
  {
    name: 'asset_read_file',
    description:
      'Read a project asset file as UTF-8 text or base64-encoded binary data. Returns { result, err }.',
    inputSchema: {
      type: 'object',
      required: ['path'],
      properties: {
        path: { type: 'string', description: 'Asset file VFS path under /assets.' },
        encoding: {
          type: 'string',
          enum: ['utf8', 'binary'],
          description: 'Read mode. Defaults to utf8. binary returns base64 text.'
        },
        timeout_ms: { type: 'number', default: 10000 }
      }
    }
  },
  {
    name: 'asset_write_file',
    description: 'Write a project asset file from UTF-8 text or base64-encoded binary data. Returns { err }.',
    inputSchema: {
      type: 'object',
      required: ['path', 'content'],
      properties: {
        path: { type: 'string', description: 'Asset file VFS path under /assets.' },
        encoding: {
          type: 'string',
          enum: ['utf8', 'binary'],
          description: 'Write mode. Defaults to utf8. binary content must be base64 text.'
        },
        content: { type: 'string', description: 'UTF-8 text or base64 binary content.' },
        timeout_ms: { type: 'number', default: 10000 }
      }
    }
  },
  */
  {
    name: 'node_attach_script',
    description:
      'Attach a script asset to a specific scene node by persistent node id. The default mode replace_same_path updates an existing attachment for the same script path instead of creating duplicates.',
    inputSchema: {
      type: 'object',
      required: ['node_id', 'script_path'],
      properties: {
        node_id: { type: 'string', description: 'Persistent id of the scene node host.' },
        script_path: { type: 'string', description: 'Writable script asset VFS path under /assets.' },
        config: SCRIPT_CONFIG_SCHEMA,
        mode: {
          type: 'string',
          enum: SCRIPT_ATTACH_MODE_VALUES,
          description:
            'replace_same_path updates a matching attachment, append always adds a new one, and replace_all replaces all current attachments on the host.'
        },
        timeout_ms: { type: 'number', default: 10000 }
      }
    }
  },
  {
    name: 'scene_attach_script',
    description:
      'Attach a script asset to the current scene host. The default mode replace_same_path updates an existing attachment for the same script path instead of creating duplicates.',
    inputSchema: {
      type: 'object',
      required: ['script_path'],
      properties: {
        script_path: { type: 'string', description: 'Writable script asset VFS path under /assets.' },
        config: SCRIPT_CONFIG_SCHEMA,
        mode: {
          type: 'string',
          enum: SCRIPT_ATTACH_MODE_VALUES,
          description:
            'replace_same_path updates a matching attachment, append always adds a new one, and replace_all replaces all current attachments on the host.'
        },
        timeout_ms: { type: 'number', default: 10000 }
      }
    }
  },
  {
    name: 'script_detach',
    description:
      'Detach one or more script attachments from a scene or scene node host. Provide index, script_path, or all=true.',
    inputSchema: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          enum: SCRIPT_TARGET_VALUES,
          description:
            'Target host resolution mode. selected resolves the current selection, treating the scene root selection as the scene host.'
        },
        node_id: {
          type: 'string',
          description: 'Required only when target is node. Persistent id of the scene node.'
        },
        index: {
          type: 'integer',
          minimum: 0,
          description: 'Optional zero-based attachment index to remove.'
        },
        script_path: {
          type: 'string',
          description:
            'Optional script asset path to remove. Combine with all=true to remove all matching attachments.'
        },
        all: {
          type: 'boolean',
          description:
            'When true, remove all attachments on the host, or all matching script_path attachments when script_path is also provided.'
        },
        timeout_ms: { type: 'number', default: 10000 }
      }
    }
  },
  {
    name: 'asset_create_material',
    description:
      'Create a material asset in a project asset directory from a built-in material class. Returns { path, err }.',
    inputSchema: {
      type: 'object',
      required: ['directory', 'class', 'name'],
      properties: {
        directory: {
          type: 'string',
          description: 'Destination VFS directory under /assets, excluding /assets/@builtins.'
        },
        class: {
          type: 'string',
          enum: MATERIAL_CLASSES,
          description: 'Built-in material class to copy from.'
        },
        name: {
          type: 'string',
          description: 'Material file name. The .zmtl extension is appended when omitted.'
        },
        overwrite: {
          type: 'boolean',
          description: 'Overwrite an existing material file when true.'
        },
        timeout_ms: { type: 'number', default: 10000 }
      }
    }
  },
  {
    name: 'asset_clone_material',
    description:
      'Clone a material asset to a writable project asset path. Use this before changing properties on a built-in material, because built-in materials are read-only and cannot be modified in place. Returns { err }.',
    inputSchema: {
      type: 'object',
      required: ['src_path', 'dst_path'],
      properties: {
        src_path: {
          type: 'string',
          description: 'Source material asset VFS path, such as /assets/@builtins/materials/unlit.zmtl.'
        },
        dst_path: {
          type: 'string',
          description:
            'Destination writable material asset VFS path under /assets, such as /assets/materials/unlit_copy.zmtl.'
        },
        timeout_ms: { type: 'number', default: 10000 }
      }
    }
  },
  {
    name: 'material_get_classes',
    description: 'Get the list of material classes supported by asset_create_material.',
    inputSchema: {
      type: 'object',
      properties: {
        timeout_ms: { type: 'number', default: 10000 }
      }
    }
  },
  {
    name: 'material_get_property_list',
    description:
      'Get the editable property metadata list for a material asset path. Returns { propertyList, err }.',
    inputSchema: {
      type: 'object',
      required: ['path'],
      properties: {
        path: { type: 'string', description: 'Material asset VFS path.' },
        timeout_ms: { type: 'number', default: 10000 }
      }
    }
  },
  {
    name: 'material_set_properties',
    description:
      'Set editable properties on a material asset and save it. Property names must match getMaterialPropertyList. Returns { err }.',
    inputSchema: {
      type: 'object',
      required: ['path', 'properties'],
      properties: {
        path: { type: 'string', description: 'Material asset VFS path.' },
        properties: {
          type: 'array',
          description:
            'Property updates. Values may be boolean, string, number, or number arrays for vec/rgb/rgba properties.',
          items: {
            type: 'object',
            required: ['property_name', 'value'],
            properties: {
              property_name: { type: 'string', description: 'Editable material property name.' },
              value: {
                description: 'Property value.',
                oneOf: [
                  { type: 'boolean' },
                  { type: 'string' },
                  { type: 'number' },
                  { type: 'array', items: { type: 'number' } }
                ]
              }
            }
          }
        },
        timeout_ms: { type: 'number', default: 10000 }
      }
    }
  },
  {
    name: 'material_get_properties',
    description:
      'Get property values from a material asset. Property names must match getMaterialPropertyList. Returns { values, err }.',
    inputSchema: {
      type: 'object',
      required: ['path', 'properties'],
      properties: {
        path: { type: 'string', description: 'Material asset VFS path.' },
        properties: {
          type: 'array',
          description: 'Material property names to read.',
          items: { type: 'string' }
        },
        timeout_ms: { type: 'number', default: 10000 }
      }
    }
  },
  {
    name: 'primitive_export_glb',
    description:
      'Export a .zmsh primitive asset to a binary .glb asset in the project VFS. Returns { path, bytes, err }.',
    inputSchema: {
      type: 'object',
      required: ['src_path'],
      properties: {
        src_path: { type: 'string', description: 'Source .zmsh primitive VFS path under /assets.' },
        dest_path: {
          type: 'string',
          description: 'Destination .glb VFS path under /assets. Defaults to src_path with .glb extension.'
        },
        timeout_ms: { type: 'number', default: 30000 }
      }
    }
  },
  {
    name: 'mesh_load_from_asset',
    description:
      'Instantiate a mesh prefab asset into the current scene. Accepts a .zprefab asset path and returns { node_id, err }.',
    inputSchema: {
      type: 'object',
      required: ['path'],
      properties: {
        path: {
          type: 'string',
          description: 'Prefab asset VFS path under /assets, such as /assets/prefabs/foo.zprefab.'
        },
        timeout_ms: { type: 'number', default: 10000 }
      }
    }
  },
  {
    name: 'mesh_create',
    description:
      'Create a mesh node in the current scene from an existing primitive and material asset. Returns { mesh_id, err }.',
    inputSchema: {
      type: 'object',
      required: ['primitive_path', 'material_path'],
      properties: {
        primitive_path: {
          type: 'string',
          description: 'Primitive asset VFS path, such as /assets/foo.zmsh.'
        },
        material_path: { type: 'string', description: 'Material asset VFS path, such as /assets/foo.zmtl.' },
        parent_id: {
          type: 'string',
          description: 'Optional persistent id of the parent scene node. Defaults to the scene root.'
        },
        timeout_ms: { type: 'number', default: 10000 }
      }
    }
  },
  {
    name: 'mesh_get_material',
    description: 'Get the material asset path assigned to a mesh node. Returns { material_path, err }.',
    inputSchema: {
      type: 'object',
      required: ['mesh_id'],
      properties: {
        mesh_id: { type: 'string', description: 'Persistent id of the mesh node.' },
        timeout_ms: { type: 'number', default: 10000 }
      }
    }
  },
  {
    name: 'mesh_set_material',
    description: 'Assign a material asset to a mesh node. Returns { err }.',
    inputSchema: {
      type: 'object',
      required: ['mesh_id', 'material_path'],
      properties: {
        mesh_id: { type: 'string', description: 'Persistent id of the mesh node.' },
        material_path: { type: 'string', description: 'Material asset VFS path.' },
        timeout_ms: { type: 'number', default: 10000 }
      }
    }
  },
  {
    name: 'mesh_get_primitive',
    description: 'Get the primitive asset path assigned to a mesh node. Returns { primitive_path, err }.',
    inputSchema: {
      type: 'object',
      required: ['mesh_id'],
      properties: {
        mesh_id: { type: 'string', description: 'Persistent id of the mesh node.' },
        timeout_ms: { type: 'number', default: 10000 }
      }
    }
  },
  {
    name: 'mesh_set_primitive',
    description: 'Assign a primitive asset to a mesh node. Returns { err }.',
    inputSchema: {
      type: 'object',
      required: ['mesh_id', 'primitive_path'],
      properties: {
        mesh_id: { type: 'string', description: 'Persistent id of the mesh node.' },
        primitive_path: { type: 'string', description: 'Primitive asset VFS path.' },
        timeout_ms: { type: 'number', default: 10000 }
      }
    }
  },
  {
    name: 'node_get_classes',
    description: 'Get the list of scene node classes that can be reported by the editor bridge.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'scene_get_property_list',
    description:
      'Get the editable property metadata list for the current scene. Returns { propertyList, err }.',
    inputSchema: {
      type: 'object',
      properties: {
        timeout_ms: { type: 'number', default: 10000 }
      }
    }
  },
  {
    name: 'scene_get_properties',
    description:
      'Get property values from the current scene. Property names must match scene_get_property_list. Returns { values, err }.',
    inputSchema: {
      type: 'object',
      required: ['properties'],
      properties: {
        properties: {
          type: 'array',
          description: 'Scene property names to read.',
          items: { type: 'string' }
        },
        timeout_ms: { type: 'number', default: 10000 }
      }
    }
  },
  {
    name: 'scene_set_properties',
    description:
      'Set editable properties on the current scene. Property names must match scene_get_property_list. Returns { err }.',
    inputSchema: {
      type: 'object',
      required: ['properties'],
      properties: {
        properties: {
          type: 'array',
          description:
            'Property updates. Values may be boolean, string, number, or number arrays for vec/rgb/rgba properties.',
          items: {
            type: 'object',
            required: ['property_name', 'value'],
            properties: {
              property_name: { type: 'string', description: 'Editable scene property name.' },
              value: {
                description: 'Property value.',
                oneOf: [
                  { type: 'boolean' },
                  { type: 'string' },
                  { type: 'number' },
                  { type: 'array', items: { type: 'number' } }
                ]
              }
            }
          }
        },
        timeout_ms: { type: 'number', default: 10000 }
      }
    }
  },
  {
    name: 'node_get_property_list',
    description:
      'Get the editable property metadata list for a scene node by persistent node id. Returns { propertyList, err }.',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', description: 'Persistent id of the scene node.' },
        timeout_ms: { type: 'number', default: 10000 }
      }
    }
  },
  {
    name: 'node_get_properties',
    description:
      'Get property values from a scene node by persistent node id. Property names must match node_get_property_list. Returns { values, err }.',
    inputSchema: {
      type: 'object',
      required: ['id', 'properties'],
      properties: {
        id: { type: 'string', description: 'Persistent id of the scene node.' },
        properties: {
          type: 'array',
          description: 'Node property names to read.',
          items: { type: 'string' }
        },
        timeout_ms: { type: 'number', default: 10000 }
      }
    }
  },
  {
    name: 'node_set_properties',
    description:
      'Set editable properties on a scene node by persistent node id. Property names must match node_get_property_list. Returns { err }.',
    inputSchema: {
      type: 'object',
      required: ['id', 'properties'],
      properties: {
        id: { type: 'string', description: 'Persistent id of the scene node.' },
        properties: {
          type: 'array',
          description:
            'Property updates. Values may be boolean, string, number, or number arrays for vec/rgb/rgba properties.',
          items: {
            type: 'object',
            required: ['property_name', 'value'],
            properties: {
              property_name: { type: 'string', description: 'Editable node property name.' },
              value: {
                description: 'Property value.',
                oneOf: [
                  { type: 'boolean' },
                  { type: 'string' },
                  { type: 'number' },
                  { type: 'array', items: { type: 'number' } }
                ]
              }
            }
          }
        },
        timeout_ms: { type: 'number', default: 10000 }
      }
    }
  },
  {
    name: 'shape_create_node',
    description:
      'Create a built-in primitive mesh node in the current scene. Supports optional parent, name, and local transform.',
    inputSchema: {
      type: 'object',
      required: ['shape'],
      properties: {
        shape: {
          type: 'string',
          enum: ['box', 'sphere', 'plane', 'cylinder', 'torus', 'tetrahedron'],
          description: 'Built-in primitive shape type.'
        },
        parent_id: {
          type: 'string',
          description: 'Optional persistent id of the parent scene node. Defaults to the scene root.'
        },
        name: {
          type: 'string',
          description: 'Optional display name for the created node.'
        },
        position: {
          type: 'array',
          minItems: 3,
          maxItems: 3,
          items: { type: 'number' },
          description: 'Optional local position as [x, y, z]. Defaults to [0, 0, 0].'
        },
        scale: {
          type: 'array',
          minItems: 3,
          maxItems: 3,
          items: { type: 'number' },
          description: 'Optional local scale as [x, y, z]. Defaults to [1, 1, 1].'
        },
        rotation: {
          type: 'array',
          minItems: 4,
          maxItems: 4,
          items: { type: 'number' },
          description: 'Optional local rotation quaternion as [x, y, z, w]. Defaults to [0, 0, 0, 1].'
        },
        timeout_ms: { type: 'number', default: 10000 }
      }
    }
  },
  {
    name: 'node_get_class',
    description:
      'Get the class of a scene node by persistent node id. Returns { nodeClass, err } where nodeClass is null on error.',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', description: 'Persistent id of the scene node.' },
        timeout_ms: { type: 'number', default: 10000 }
      }
    }
  },
  {
    name: 'node_get_local_transform',
    description:
      'Get a scene node local transform relative to its parent. Returns position, scale, and rotation quaternion arrays.',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', description: 'Persistent id of the scene node.' },
        timeout_ms: { type: 'number', default: 10000 }
      }
    }
  },
  {
    name: 'node_set_local_transform',
    description:
      'Set a scene node local transform relative to its parent. Omit position, scale, or rotation to keep the current value.',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', description: 'Persistent id of the scene node.' },
        position: {
          type: 'array',
          minItems: 3,
          maxItems: 3,
          items: { type: 'number' },
          description: 'Optional local position as [x, y, z].'
        },
        scale: {
          type: 'array',
          minItems: 3,
          maxItems: 3,
          items: { type: 'number' },
          description: 'Optional local scale as [x, y, z].'
        },
        rotation: {
          type: 'array',
          minItems: 4,
          maxItems: 4,
          items: { type: 'number' },
          description: 'Optional local rotation quaternion as [x, y, z, w].'
        },
        timeout_ms: { type: 'number', default: 10000 }
      }
    }
  },
  {
    name: 'scene_get_root_node',
    description: 'Get the current scene root node. Returns { node: { id, name }, err }.',
    inputSchema: {
      type: 'object',
      properties: {
        timeout_ms: { type: 'number', default: 10000 }
      }
    }
  },
  {
    name: 'node_get_parent',
    description: 'Get the parent node id of a scene node by persistent node id. Returns { parentNode, err }.',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', description: 'Persistent id of the scene node.' },
        timeout_ms: { type: 'number', default: 10000 }
      }
    }
  },
  {
    name: 'node_create',
    description: 'Create a scene node in the current scene. Returns { node_id, err }.',
    inputSchema: {
      type: 'object',
      properties: {
        parent_id: {
          type: 'string',
          description: 'Optional persistent id of the parent scene node. Defaults to the scene root.'
        },
        timeout_ms: { type: 'number', default: 10000 }
      }
    }
  },
  {
    name: 'node_remove',
    description: 'Remove a scene node by persistent node id. Returns { err }.',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', description: 'Persistent id of the scene node.' },
        timeout_ms: { type: 'number', default: 10000 }
      }
    }
  },
  {
    name: 'node_set_parent',
    description:
      'Set a scene node parent by persistent node id. Use transform_mode to choose whether to preserve the node world transform matrix or local transform. Defaults to preserve_world. Returns { err }.',
    inputSchema: {
      type: 'object',
      required: ['id', 'parent_id'],
      properties: {
        id: { type: 'string', description: 'Persistent id of the scene node.' },
        parent_id: { type: 'string', description: 'Persistent id of the new parent scene node.' },
        transform_mode: {
          type: 'string',
          enum: NODE_REPARENT_TRANSFORM_MODE_VALUES,
          description:
            'Transform preservation mode. Use preserve_world to keep the node world transform unchanged after reparenting, or preserve_local to keep the local transform unchanged. Defaults to preserve_world.'
        },
        timeout_ms: { type: 'number', default: 10000 }
      }
    }
  },
  {
    name: 'node_get_children',
    description: 'Get direct child nodes of a scene node. Returns { subNodes: [{ id, name }], err }.',
    inputSchema: {
      type: 'object',
      required: ['parent'],
      properties: {
        parent: { type: 'string', description: 'Persistent id of the parent scene node.' },
        timeout_ms: { type: 'number', default: 10000 }
      }
    }
  },
  {
    name: 'scene_get_selected_nodes',
    description: 'Get the currently selected scene node ids. Returns { nodes, err }.',
    inputSchema: {
      type: 'object',
      properties: {
        timeout_ms: { type: 'number', default: 10000 }
      }
    }
  },
  {
    name: 'camera_get_active',
    description:
      'Get the active scene camera in world space. Returns camera metadata, world transform, direction vectors, and controller view center when available.',
    inputSchema: {
      type: 'object',
      properties: {
        timeout_ms: { type: 'number', default: 10000 }
      }
    }
  },
  {
    name: 'camera_set_active',
    description:
      'Set the active scene camera by persistent camera node id. Returns the new active camera state in world space.',
    inputSchema: {
      type: 'object',
      required: ['camera_id'],
      properties: {
        camera_id: { type: 'string', description: 'Persistent id of the camera node to make active.' },
        timeout_ms: { type: 'number', default: 10000 }
      }
    }
  },
  {
    name: 'camera_look_at',
    description:
      'Aim a camera using world-space position and target. When camera_id is omitted, this operates on the active scene camera.',
    inputSchema: {
      type: 'object',
      required: ['target'],
      properties: {
        camera_id: {
          type: 'string',
          description: 'Optional persistent id of the camera node. Defaults to the active scene camera.'
        },
        position: {
          type: 'array',
          minItems: 3,
          maxItems: 3,
          items: { type: 'number' },
          description:
            'Optional world-space camera position as [x, y, z]. Defaults to the camera current world position.'
        },
        target: {
          type: 'array',
          minItems: 3,
          maxItems: 3,
          items: { type: 'number' },
          description: 'Required world-space look target as [x, y, z].'
        },
        up: {
          type: 'array',
          minItems: 3,
          maxItems: 3,
          items: { type: 'number' },
          description: 'Optional world-space up vector as [x, y, z]. Defaults to [0, 1, 0].'
        },
        timeout_ms: { type: 'number', default: 10000 }
      },
      examples: [
        {
          target: [0, 1, 0]
        },
        {
          position: [8, 6, 8],
          target: [0, 1, 0],
          up: [0, 1, 0]
        }
      ]
    }
  },
  {
    name: 'model_generate_begin',
    description:
      'Start an editor-side worker job that tessellates a compact procedural model spec into a .zmsh mesh asset and optionally creates a mesh node in the current scene. Use this for LLM-generated geometry instead of sending large raw vertex buffers through MCP. The schema includes concrete examples for box, revolve, and CSG workflows.',
    inputSchema: {
      type: 'object',
      required: ['spec', 'dest_path'],
      properties: {
        spec: {
          ...GENERATED_MODEL_SPEC_SCHEMA
        },
        dest_path: {
          type: 'string',
          description: 'Destination .zmsh VFS path under /assets.',
          examples: ['/assets/generated/pedestal.zmsh', '/assets/generated/vase.zmsh']
        },
        name: {
          type: 'string',
          description: 'Optional mesh node name when create_node is true.',
          examples: ['Pedestal', 'Vase', 'ArchCutout']
        },
        create_node: { type: 'boolean', default: true },
        generation_timeout_ms: { type: 'number', default: 60000 },
        timeout_ms: { type: 'number', default: 10000 }
      },
      examples: MODEL_GENERATE_BEGIN_EXAMPLES
    }
  },
  {
    name: 'model_generate_status',
    description:
      'Get status for an editor-side procedural model generation job. Pass job_id from model_generate_begin.',
    inputSchema: {
      type: 'object',
      required: ['job_id'],
      properties: {
        job_id: { type: 'string' },
        timeout_ms: { type: 'number', default: 10000 }
      }
    }
  },
  {
    name: 'model_generate_cancel',
    description:
      'Cancel an editor-side procedural model generation job. Pass job_id from model_generate_begin.',
    inputSchema: {
      type: 'object',
      required: ['job_id'],
      properties: {
        job_id: { type: 'string' },
        timeout_ms: { type: 'number', default: 10000 }
      }
    }
  },
  {
    name: 'editor_create_scene',
    description:
      'Create a new scene in the current project. Optionally provide path, such as /assets/new_scene.zscn. Returns editor status plus err if failed.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Optional destination scene VFS path ending in .zscn.' },
        reset_view: { type: 'boolean', default: true, description: 'Reset the scene view camera.' },
        timeout_ms: { type: 'number', default: 30000 }
      }
    }
  },
  {
    name: 'editor_open_scene',
    description:
      'Open an existing scene asset in the current project. Returns editor status plus err if failed.',
    inputSchema: {
      type: 'object',
      required: ['path'],
      properties: {
        path: { type: 'string', description: 'Scene VFS path, such as /assets/my_scene.zscn.' },
        reset_view: { type: 'boolean', default: true, description: 'Reset the scene view camera.' },
        timeout_ms: { type: 'number', default: 30000 }
      }
    }
  },
  {
    name: 'editor_save_scene',
    description: 'Save the current scene to its existing path. Returns editor status plus err if failed.',
    inputSchema: {
      type: 'object',
      properties: {
        timeout_ms: { type: 'number', default: 30000 }
      }
    }
  },
  {
    name: 'editor_call',
    description:
      'Advanced escape hatch: call a raw browser bridge method. Prefer the typed tools such as editor_create_scene, editor_open_scene, editor_save_scene, editor_screenshot, editor_console_logs, and editor_sample_pixels when available.',
    inputSchema: {
      type: 'object',
      required: ['method'],
      properties: {
        method: { type: 'string' },
        params: { type: 'object' },
        timeout_ms: { type: 'number', default: 30000 }
      }
    }
  },
  {
    name: 'editor_eval',
    description:
      'Run JavaScript in the editor page. The script receives editor, controller, scene, getDevice, getEngine, and args bindings.',
    inputSchema: {
      type: 'object',
      required: ['script'],
      properties: {
        script: { type: 'string' },
        expression: { type: 'boolean', default: false },
        timeout_ms: { type: 'number', default: 30000 }
      }
    }
  },
  {
    name: 'editor_screenshot',
    description: 'Capture the editor canvas and return image content plus screenshot metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        mime_type: { type: 'string', default: 'image/png' }
      }
    }
  },
  {
    name: 'editor_console_logs',
    description: 'Fetch recent browser console logs captured by the editor bridge.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', default: 100 }
      }
    }
  }
];

const HIDDEN_TOOL_NAMES = new Set(['editor_connect_info', 'editor_call', 'editor_eval']);

function cloneSchema(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function toSnakeCase(value) {
  return String(value)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase();
}

function toCamelCase(value) {
  return String(value).replace(/[_-]([a-z])/g, (_match, ch) => ch.toUpperCase());
}

function normalizeResultKeysToSnakeCase(value) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeResultKeysToSnakeCase(item));
  }
  if (value && typeof value === 'object') {
    const normalized = {};
    for (const [key, childValue] of Object.entries(value)) {
      normalized[toSnakeCase(key)] = normalizeResultKeysToSnakeCase(childValue);
    }
    return normalized;
  }
  return value;
}

function normalizeGeneratedModelSpec(value, key = '') {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeGeneratedModelSpec(item));
  }
  if (value && typeof value === 'object') {
    const normalized = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      const normalizedKey = toCamelCase(childKey);
      normalized[normalizedKey] = normalizeGeneratedModelSpec(childValue, normalizedKey);
    }
    return normalized;
  }
  if (typeof value === 'string') {
    switch (key) {
      case 'coordinateSystem':
      case 'coordinate_system':
        return (
          {
            editor: 'editor',
            y_up: 'yUp',
            yup: 'yUp',
            yUp: 'yUp',
            z_up: 'zUp',
            zup: 'zUp',
            zUp: 'zUp'
          }[value] ?? value
        );
      case 'coordinateRemap':
      case 'coordinate_remap':
        return (
          {
            none: 'none',
            z_up_to_y_up: 'zUpToYUp',
            zUpToYUp: 'zUpToYUp',
            y_up_to_z_up: 'yUpToZUp',
            yUpToZUp: 'yUpToZUp'
          }[value] ?? value
        );
      case 'surfaceType':
      case 'surface_type':
        return (
          {
            bezier_patch: 'bezierPatch',
            bezierPatch: 'bezierPatch'
          }[value] ?? value
        );
      case 'curveType':
      case 'curve_type':
        return (
          {
            polyline: 'polyline',
            bezier: 'bezier',
            catmull_rom: 'catmullRom',
            catmullRom: 'catmullRom',
            nurbs: 'nurbs'
          }[value] ?? value
        );
      case 'language':
        return (
          {
            javascript: 'javascript',
            js: 'js'
          }[value] ?? value
        );
      default:
        return value;
    }
  }
  return value;
}

function readFirstStringArg(args, keys) {
  if (!args || typeof args !== 'object') {
    return '';
  }
  for (const key of keys) {
    const value = args[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

function buildToolCatalog() {
  const publicTools = [];
  for (const tool of BASE_TOOLS) {
    if (!HIDDEN_TOOL_NAMES.has(tool.name)) {
      publicTools.push({
        ...tool,
        inputSchema: cloneSchema(tool.inputSchema ?? { type: 'object', properties: {} })
      });
    }
  }
  return publicTools;
}

const TOOLS = buildToolCatalog();

const handlers = {
  async docs_search_types(args) {
    const query = typeof args.query === 'string' ? args.query.trim() : '';
    if (!query) {
      return { query: '', matches: [], err: 'docs_search_types requires query' };
    }
    const packageName = typeof args.package === 'string' && args.package.trim() ? args.package.trim() : '';
    if (packageName && !ASSISTANT_TYPE_PACKAGES.includes(packageName)) {
      return { query, matches: [], err: `Unsupported type package: ${packageName}` };
    }
    const limit = Math.max(1, Math.min(Number(args.limit) || 5, 20));
    const tokens = tokenizeSearchText(query);
    const normalizedQuery = normalizeSearchValue(query);
    const index = await loadAssistantTypeIndex();
    const matches = index.entries
      .filter((entry) => !packageName || entry.package === packageName)
      .map((entry) => ({
        entry,
        score: scoreTypeEntry(entry, normalizedQuery, tokens)
      }))
      .filter((item) => item.score > 0)
      .sort(
        (a, b) =>
          b.score - a.score ||
          a.entry.symbol.localeCompare(b.entry.symbol) ||
          a.entry.startLine - b.entry.startLine
      )
      .slice(0, limit)
      .map((item) => summarizeTypeEntry(item.entry, item.score));
    return {
      query,
      package: packageName || null,
      totalEntries: index.entries.length,
      matches
    };
  },
  async docs_get_type_symbol(args) {
    const id = typeof args.id === 'string' ? args.id.trim() : '';
    const symbol = typeof args.symbol === 'string' ? args.symbol.trim() : '';
    const packageName = typeof args.package === 'string' && args.package.trim() ? args.package.trim() : '';
    if (!id && !symbol) {
      return { symbol: null, entry: null, err: 'docs_get_type_symbol requires id or symbol' };
    }
    if (packageName && !ASSISTANT_TYPE_PACKAGES.includes(packageName)) {
      return { symbol: symbol || id, entry: null, err: `Unsupported type package: ${packageName}` };
    }
    const maxLines = Math.max(20, Math.min(Number(args.max_lines) || 160, MAX_TYPE_FILE_LINES));
    const index = await loadAssistantTypeIndex();
    const entry = findTypeEntryByReference(index, id || symbol, packageName);
    if (!entry) {
      return { symbol: symbol || id, entry: null, err: 'Type entry not found' };
    }
    const excerpt = await readBundledTypeFileExcerpt(
      entry.package,
      entry.path,
      entry.startLine,
      Math.min(entry.endLine, entry.startLine + maxLines - 1)
    );
    const relatedSymbols = index.entries
      .filter((candidate) => candidate.containerSymbol === entry.symbol)
      .slice(0, 64)
      .map((candidate) => ({
        id: candidate.id,
        symbol: candidate.symbol,
        kind: candidate.kind,
        startLine: candidate.startLine,
        endLine: candidate.endLine,
        signature: candidate.signature
      }));
    return {
      symbol: entry.symbol,
      entry: summarizeTypeEntry(entry),
      excerpt,
      relatedSymbols,
      excerptTruncated: excerpt.truncated || entry.endLine > excerpt.endLine
    };
  },
  async docs_read_type_file(args) {
    const packageName = typeof args.package === 'string' ? args.package.trim() : '';
    const relativePath = typeof args.path === 'string' ? args.path.trim() : '';
    if (!packageName || !relativePath) {
      return {
        package: packageName || null,
        path: relativePath || null,
        err: 'docs_read_type_file requires package and path'
      };
    }
    if (!ASSISTANT_TYPE_PACKAGES.includes(packageName)) {
      return { package: packageName, path: relativePath, err: `Unsupported type package: ${packageName}` };
    }
    try {
      return await readBundledTypeFileExcerpt(packageName, relativePath, args.start_line, args.end_line);
    } catch (err) {
      return {
        package: packageName,
        path: relativePath,
        err: err instanceof Error ? err.message : String(err)
      };
    }
  },
  async editor_connect_info(args) {
    const base = args.base_url || DEFAULT_EDITOR_URL;
    const url = new URL(base);
    url.searchParams.set('mcp', String(bridge.port));
    url.searchParams.set('mcpToken', BRIDGE_TOKEN);
    if (args.device) {
      url.searchParams.set('device', String(args.device));
    }
    if (args.project) {
      url.searchParams.set('project', String(args.project));
    }
    if (args.remote) {
      url.searchParams.set('remote', '');
    }
    if (args.open) {
      url.searchParams.set('open', '');
    }
    return {
      ...bridge.getInfo(),
      editorUrl: url.toString()
    };
  },
  async editor_wait_ready(args) {
    const client = await bridge.waitForClient(Number(args.timeout_ms ?? 30000));
    return { ...bridge.getInfo(), client };
  },
  async editor_status() {
    return bridge.send('status', {}, 10000);
  },
  async project_list() {
    return bridge.send('getProjectList', {}, 10000);
  },
  async project_get_current() {
    return bridge.send('getCurrentProject', {}, 10000);
  },
  async project_create(args) {
    const name = typeof args.name === 'string' ? args.name.trim() : '';
    if (!name) {
      return { id: null, err: 'Project name is required to create' };
    }
    const params = {
      name,
      save_scene_changes: !!args.save_scene_changes,
      discard_scene_changes: !!args.discard_scene_changes
    };
    if (typeof args.path === 'string' && args.path.trim()) {
      params.path = args.path.trim();
    }
    return bridge.send('createProject', params, Number(args.timeout_ms ?? 30000));
  },
  async project_open(args) {
    const id = typeof args.id === 'string' ? args.id.trim() : '';
    if (!id) {
      return { id: null, err: 'Project id is required to open' };
    }
    return bridge.send(
      'openProject',
      {
        id,
        save_scene_changes: !!args.save_scene_changes,
        discard_scene_changes: !!args.discard_scene_changes
      },
      Number(args.timeout_ms ?? 30000)
    );
  },
  async project_close(args) {
    return bridge.send(
      'closeProject',
      {
        save_scene_changes: !!args.save_scene_changes,
        discard_scene_changes: !!args.discard_scene_changes
      },
      Number(args.timeout_ms ?? 30000)
    );
  },
  async project_export(args) {
    return bridge.send(
      'exportProject',
      {
        save_scene_changes: !!args.save_scene_changes,
        discard_scene_changes: !!args.discard_scene_changes
      },
      Number(args.timeout_ms ?? 60000)
    );
  },
  async project_delete(args) {
    return bridge.send(
      'deleteProject',
      {
        save_scene_changes: !!args.save_scene_changes,
        discard_scene_changes: !!args.discard_scene_changes
      },
      Number(args.timeout_ms ?? 30000)
    );
  },
  async asset_get_root(args) {
    return bridge.send('asset_get_root_directory', {}, Number(args.timeout_ms ?? 10000));
  },
  async asset_get_builtin_primitives(args) {
    return bridge.send('asset_get_builtin_primitives', {}, Number(args.timeout_ms ?? 10000));
  },
  async asset_get_builtin_materials(args) {
    return bridge.send('asset_get_builtin_materials', {}, Number(args.timeout_ms ?? 10000));
  },
  async asset_read_directory(args) {
    const path = typeof args.path === 'string' ? args.path.trim() : '';
    if (!path) {
      return { result: null, err: 'asset_read_directory requires the path' };
    }
    const params = { path };
    if (Object.prototype.hasOwnProperty.call(args, 'recursive')) {
      params.recursive = args.recursive;
    }
    if (Object.prototype.hasOwnProperty.call(args, 'pattern')) {
      params.pattern = args.pattern;
    }
    return bridge.send('asset_read_directory', params, Number(args.timeout_ms ?? 10000));
  },
  async script_get_context(args) {
    const params = {
      target: typeof args.target === 'string' && args.target.trim() ? args.target.trim() : 'selected'
    };
    if (typeof args.node_id === 'string' && args.node_id.trim()) {
      params.node_id = args.node_id.trim();
    }
    return bridge.send('getScriptContext', params, Number(args.timeout_ms ?? 10000));
  },
  async script_list_attachments(args) {
    const params = {
      target: typeof args.target === 'string' && args.target.trim() ? args.target.trim() : 'selected'
    };
    if (typeof args.node_id === 'string' && args.node_id.trim()) {
      params.node_id = args.node_id.trim();
    }
    return bridge.send('listScriptAttachments', params, Number(args.timeout_ms ?? 10000));
  },
  async script_read_source(args) {
    const path = readFirstStringArg(args, ['path', 'script_path', 'scriptPath', 'file_path', 'filePath']);
    if (!path) {
      return { path: null, language: null, content: null, err: 'script_read_source requires path' };
    }
    return bridge.send('readScriptSource', { path }, Number(args.timeout_ms ?? 10000));
  },
  async script_write_source(args) {
    const path = readFirstStringArg(args, ['path', 'script_path', 'scriptPath', 'file_path', 'filePath']);
    if (!path) {
      return {
        path: null,
        language: null,
        created: null,
        bytes: null,
        err: 'script_write_source requires path'
      };
    }
    if (typeof args.content !== 'string') {
      return {
        path,
        language: null,
        created: null,
        bytes: null,
        err: 'script_write_source requires content as a string'
      };
    }
    const params = {
      path,
      content: args.content
    };
    if (Object.prototype.hasOwnProperty.call(args, 'overwrite')) {
      params.overwrite = !!args.overwrite;
    }
    return bridge.send('writeScriptSource', params, Number(args.timeout_ms ?? 10000));
  },
  async script_diagnostics(args) {
    const path = readFirstStringArg(args, ['path', 'script_path', 'scriptPath', 'file_path', 'filePath']);
    if (!path) {
      return {
        path: null,
        language: null,
        diagnostics: null,
        summary: null,
        err: 'script_diagnostics requires path'
      };
    }
    return bridge.send('diagnoseScriptSource', { path }, Number(args.timeout_ms ?? 10000));
  },
  async asset_read_file(args) {
    const path = typeof args.path === 'string' ? args.path.trim() : '';
    if (!path) {
      return { result: null, err: 'asset_read_file requires the path' };
    }
    const encoding = typeof args.encoding === 'string' ? args.encoding.trim() : 'utf8';
    if (encoding !== 'utf8' && encoding !== 'binary') {
      return { result: null, err: 'asset_read_file encoding must be `utf8` or `binary`' };
    }
    return bridge.send('asset_read_file', { path, encoding }, Number(args.timeout_ms ?? 10000));
  },
  async asset_write_file(args) {
    const path = typeof args.path === 'string' ? args.path.trim() : '';
    if (!path) {
      return { err: 'asset_write_file requires the path' };
    }
    const encoding = typeof args.encoding === 'string' ? args.encoding.trim() : 'utf8';
    if (encoding !== 'utf8' && encoding !== 'binary') {
      return { err: 'asset_write_file encoding must be `utf8` or `binary`' };
    }
    if (typeof args.content !== 'string') {
      return { err: 'asset_write_file requires string content' };
    }
    return bridge.send(
      'asset_write_file',
      { path, encoding, content: args.content },
      Number(args.timeout_ms ?? 10000)
    );
  },
  async asset_create_material(args) {
    const directory = typeof args.directory === 'string' ? args.directory.trim() : '';
    if (!directory) {
      return { path: null, err: 'asset_create_material requires the directory' };
    }
    const materialClass = typeof args.class === 'string' ? args.class.trim() : '';
    if (!materialClass) {
      return { path: null, err: 'asset_create_material requires the class' };
    }
    const name = typeof args.name === 'string' ? args.name.trim() : '';
    if (!name) {
      return { path: null, err: 'asset_create_material requires the name' };
    }
    const params = { directory, class: materialClass, name };
    if (Object.prototype.hasOwnProperty.call(args, 'overwrite')) {
      params.overwrite = args.overwrite;
    }
    return bridge.send('asset_create_material', params, Number(args.timeout_ms ?? 10000));
  },
  async asset_clone_material(args) {
    const srcPath = typeof args.src_path === 'string' ? args.src_path.trim() : '';
    if (!srcPath) {
      return { err: 'asset_clone_material requires src_path' };
    }
    const dstPath = typeof args.dst_path === 'string' ? args.dst_path.trim() : '';
    if (!dstPath) {
      return { err: 'asset_clone_material requires dst_path' };
    }
    return bridge.send(
      'asset_clone_material',
      { src_path: srcPath, dst_path: dstPath },
      Number(args.timeout_ms ?? 10000)
    );
  },
  async node_attach_script(args) {
    const nodeId = typeof args.node_id === 'string' ? args.node_id.trim() : '';
    if (!nodeId) {
      return { host: null, attachments: null, err: 'node_attach_script requires node_id' };
    }
    const scriptPath = readFirstStringArg(args, [
      'script_path',
      'scriptPath',
      'path',
      'file_path',
      'filePath'
    ]);
    if (!scriptPath) {
      return { host: null, attachments: null, err: 'node_attach_script requires script_path' };
    }
    const params = {
      node_id: nodeId,
      script_path: scriptPath
    };
    if (Object.prototype.hasOwnProperty.call(args, 'config')) {
      params.config = args.config;
    }
    if (typeof args.mode === 'string' && args.mode.trim()) {
      params.mode = args.mode.trim();
    }
    return bridge.send('attachScriptToNode', params, Number(args.timeout_ms ?? 10000));
  },
  async scene_attach_script(args) {
    const scriptPath = readFirstStringArg(args, [
      'script_path',
      'scriptPath',
      'path',
      'file_path',
      'filePath'
    ]);
    if (!scriptPath) {
      return { host: null, attachments: null, err: 'scene_attach_script requires script_path' };
    }
    const params = {
      script_path: scriptPath
    };
    if (Object.prototype.hasOwnProperty.call(args, 'config')) {
      params.config = args.config;
    }
    if (typeof args.mode === 'string' && args.mode.trim()) {
      params.mode = args.mode.trim();
    }
    return bridge.send('attachScriptToScene', params, Number(args.timeout_ms ?? 10000));
  },
  async script_detach(args) {
    const params = {
      target: typeof args.target === 'string' && args.target.trim() ? args.target.trim() : 'selected'
    };
    if (typeof args.node_id === 'string' && args.node_id.trim()) {
      params.node_id = args.node_id.trim();
    }
    if (Number.isInteger(args.index)) {
      params.index = args.index;
    } else if (Object.prototype.hasOwnProperty.call(args, 'index')) {
      return {
        host: null,
        attachments: null,
        removed_count: 0,
        err: 'script_detach index must be an integer'
      };
    }
    const scriptPath = readFirstStringArg(args, [
      'script_path',
      'scriptPath',
      'path',
      'file_path',
      'filePath'
    ]);
    if (scriptPath) {
      params.script_path = scriptPath;
    }
    if (Object.prototype.hasOwnProperty.call(args, 'all')) {
      params.all = !!args.all;
    }
    return bridge.send('detachScriptAttachment', params, Number(args.timeout_ms ?? 10000));
  },
  async material_get_classes(args) {
    return bridge.send('getMaterialClasses', {}, Number(args.timeout_ms ?? 10000));
  },
  async material_get_property_list(args) {
    const path = typeof args.path === 'string' ? args.path.trim() : '';
    if (!path) {
      return { propertyList: null, err: 'material_get_property_list requires the material file path' };
    }
    return bridge.send('getMaterialPropertyList', { path }, Number(args.timeout_ms ?? 10000));
  },
  async material_set_properties(args) {
    const path = typeof args.path === 'string' ? args.path.trim() : '';
    if (!path) {
      return { err: 'material_set_properties requires the material file path' };
    }
    if (!Array.isArray(args.properties)) {
      return { err: 'material_set_properties requires the property list' };
    }
    const properties = [];
    for (const prop of args.properties) {
      if (!prop || typeof prop !== 'object') {
        return { err: 'material_set_properties property entries must be objects' };
      }
      const propertyName = typeof prop.property_name === 'string' ? prop.property_name.trim() : '';
      if (!propertyName) {
        return { err: 'material_set_properties requires the material property name' };
      }
      if (!Object.prototype.hasOwnProperty.call(prop, 'value')) {
        return { err: `material_set_properties requires value for property ${propertyName}` };
      }
      properties.push({ property_name: propertyName, value: prop.value });
    }
    return bridge.send('material_set_properties', { path, properties }, Number(args.timeout_ms ?? 10000));
  },
  async material_get_properties(args) {
    const path = typeof args.path === 'string' ? args.path.trim() : '';
    if (!path) {
      return { values: null, err: 'material_get_properties requires the material file path' };
    }
    if (!Array.isArray(args.properties) || args.properties.some((value) => typeof value !== 'string')) {
      return { values: null, err: 'material_get_properties requires the property list as string array' };
    }
    const properties = args.properties.map((value) => value.trim()).filter((value) => value);
    if (properties.length !== args.properties.length) {
      return { values: null, err: 'material_get_properties property names must be non-empty strings' };
    }
    return bridge.send('material_get_properties', { path, properties }, Number(args.timeout_ms ?? 10000));
  },
  async primitive_export_glb(args) {
    const srcPath = typeof args.src_path === 'string' ? args.src_path.trim() : '';
    if (!srcPath) {
      return { path: null, bytes: 0, err: 'primitive_export_glb requires src_path' };
    }
    const params = { src_path: srcPath };
    if (typeof args.dest_path === 'string' && args.dest_path.trim()) {
      params.dest_path = args.dest_path.trim();
    }
    return bridge.send('primitive_export_glb', params, Number(args.timeout_ms ?? 30000));
  },
  async mesh_load_from_asset(args) {
    const path = typeof args.path === 'string' ? args.path.trim() : '';
    if (!path) {
      return { node_id: null, err: 'mesh_load_from_asset requires the path' };
    }
    return bridge.send('mesh_load_from_asset', { path }, Number(args.timeout_ms ?? 10000));
  },
  async mesh_create(args) {
    const primitivePath = typeof args.primitive_path === 'string' ? args.primitive_path.trim() : '';
    if (!primitivePath) {
      return { mesh_id: null, err: 'mesh_create requires the primitive_path' };
    }
    const materialPath = typeof args.material_path === 'string' ? args.material_path.trim() : '';
    if (!materialPath) {
      return { mesh_id: null, err: 'mesh_create requires the material_path' };
    }
    const params = {
      primitive_path: primitivePath,
      material_path: materialPath
    };
    if (typeof args.parent_id === 'string' && args.parent_id.trim()) {
      params.parent_id = args.parent_id.trim();
    }
    return bridge.send('mesh_create', params, Number(args.timeout_ms ?? 10000));
  },
  async mesh_get_material(args) {
    const meshId = typeof args.mesh_id === 'string' ? args.mesh_id.trim() : '';
    if (!meshId) {
      return { material_path: null, err: 'mesh_get_material requires the mesh_id' };
    }
    return bridge.send('mesh_get_material', { mesh_id: meshId }, Number(args.timeout_ms ?? 10000));
  },
  async mesh_set_material(args) {
    const meshId = typeof args.mesh_id === 'string' ? args.mesh_id.trim() : '';
    if (!meshId) {
      return { err: 'mesh_set_material requires the mesh_id' };
    }
    const materialPath = typeof args.material_path === 'string' ? args.material_path.trim() : '';
    if (!materialPath) {
      return { err: 'mesh_set_material requires the material_path' };
    }
    return bridge.send(
      'mesh_set_material',
      { mesh_id: meshId, material_path: materialPath },
      Number(args.timeout_ms ?? 10000)
    );
  },
  async mesh_get_primitive(args) {
    const meshId = typeof args.mesh_id === 'string' ? args.mesh_id.trim() : '';
    if (!meshId) {
      return { primitive_path: null, err: 'mesh_get_primitive requires the mesh_id' };
    }
    return bridge.send('mesh_get_primitive', { mesh_id: meshId }, Number(args.timeout_ms ?? 10000));
  },
  async mesh_set_primitive(args) {
    const meshId = typeof args.mesh_id === 'string' ? args.mesh_id.trim() : '';
    if (!meshId) {
      return { err: 'mesh_set_primitive requires the mesh_id' };
    }
    const primitivePath = typeof args.primitive_path === 'string' ? args.primitive_path.trim() : '';
    if (!primitivePath) {
      return { err: 'mesh_set_primitive requires the primitive_path' };
    }
    return bridge.send(
      'mesh_set_primitive',
      { mesh_id: meshId, primitive_path: primitivePath },
      Number(args.timeout_ms ?? 10000)
    );
  },
  async node_get_classes(args) {
    return bridge.send('getNodeClasses', {}, Number(args.timeout_ms ?? 10000));
  },
  async scene_get_property_list(args) {
    return bridge.send('getScenePropertyList', {}, Number(args.timeout_ms ?? 10000));
  },
  async scene_get_properties(args) {
    if (!Array.isArray(args.properties) || args.properties.some((value) => typeof value !== 'string')) {
      return { values: null, err: 'scene_get_properties requires the property list as string array' };
    }
    const properties = args.properties.map((value) => value.trim()).filter((value) => value);
    if (properties.length !== args.properties.length) {
      return { values: null, err: 'scene_get_properties property names must be non-empty strings' };
    }
    return bridge.send('scene_get_properties', { properties }, Number(args.timeout_ms ?? 10000));
  },
  async scene_set_properties(args) {
    if (!Array.isArray(args.properties)) {
      return { err: 'scene_set_properties requires the property list' };
    }
    const properties = [];
    for (const prop of args.properties) {
      if (!prop || typeof prop !== 'object') {
        return { err: 'scene_set_properties property entries must be objects' };
      }
      const propertyName = typeof prop.property_name === 'string' ? prop.property_name.trim() : '';
      if (!propertyName) {
        return { err: 'scene_set_properties requires the scene property name' };
      }
      if (!Object.prototype.hasOwnProperty.call(prop, 'value')) {
        return { err: `scene_set_properties requires value for property ${propertyName}` };
      }
      properties.push({ property_name: propertyName, value: prop.value });
    }
    return bridge.send('scene_set_properties', { properties }, Number(args.timeout_ms ?? 10000));
  },
  async node_get_property_list(args) {
    const id = typeof args.id === 'string' ? args.id.trim() : '';
    if (!id) {
      return { propertyList: null, err: 'node_get_property_list requires the node id' };
    }
    return bridge.send('getNodePropertyList', { id }, Number(args.timeout_ms ?? 10000));
  },
  async node_get_properties(args) {
    const id = typeof args.id === 'string' ? args.id.trim() : '';
    if (!id) {
      return { values: null, err: 'node_get_properties requires the node id' };
    }
    if (!Array.isArray(args.properties) || args.properties.some((value) => typeof value !== 'string')) {
      return { values: null, err: 'node_get_properties requires the property list as string array' };
    }
    const properties = args.properties.map((value) => value.trim()).filter((value) => value);
    if (properties.length !== args.properties.length) {
      return { values: null, err: 'node_get_properties property names must be non-empty strings' };
    }
    return bridge.send('node_get_properties', { id, properties }, Number(args.timeout_ms ?? 10000));
  },
  async node_set_properties(args) {
    const id = typeof args.id === 'string' ? args.id.trim() : '';
    if (!id) {
      return { err: 'node_set_properties requires the node id' };
    }
    if (!Array.isArray(args.properties)) {
      return { err: 'node_set_properties requires the property list' };
    }
    const properties = [];
    for (const prop of args.properties) {
      if (!prop || typeof prop !== 'object') {
        return { err: 'node_set_properties property entries must be objects' };
      }
      const propertyName = typeof prop.property_name === 'string' ? prop.property_name.trim() : '';
      if (!propertyName) {
        return { err: 'node_set_properties requires the node property name' };
      }
      if (!Object.prototype.hasOwnProperty.call(prop, 'value')) {
        return { err: `node_set_properties requires value for property ${propertyName}` };
      }
      properties.push({ property_name: propertyName, value: prop.value });
    }
    return bridge.send('node_set_properties', { id, properties }, Number(args.timeout_ms ?? 10000));
  },
  async shape_create_node(args) {
    const shape = typeof args.shape === 'string' ? args.shape.trim() : '';
    if (!shape) {
      return { node: null, transform: null, err: 'shape_create_node requires the shape type' };
    }
    const params = { shape };
    if (typeof args.parent_id === 'string' && args.parent_id.trim()) {
      params.parent_id = args.parent_id.trim();
    }
    if (typeof args.name === 'string' && args.name.trim()) {
      params.name = args.name.trim();
    }
    if (Object.prototype.hasOwnProperty.call(args, 'position')) {
      params.position = args.position;
    }
    if (Object.prototype.hasOwnProperty.call(args, 'scale')) {
      params.scale = args.scale;
    }
    if (Object.prototype.hasOwnProperty.call(args, 'rotation')) {
      params.rotation = args.rotation;
    }
    return bridge.send('createShapeNode', params, Number(args.timeout_ms ?? 10000));
  },
  async node_get_class(args) {
    const id = typeof args.id === 'string' ? args.id.trim() : '';
    if (!id) {
      return { nodeClass: null, err: 'node_get_class requires the node id' };
    }
    return bridge.send('getNodeClass', { id }, Number(args.timeout_ms ?? 10000));
  },
  async node_get_local_transform(args) {
    const id = typeof args.id === 'string' ? args.id.trim() : '';
    if (!id) {
      return { transform: null, err: 'node_get_local_transform requires the node id' };
    }
    return bridge.send('getNodeLocalTransform', { id }, Number(args.timeout_ms ?? 10000));
  },
  async node_set_local_transform(args) {
    const id = typeof args.id === 'string' ? args.id.trim() : '';
    if (!id) {
      return { transform: null, err: 'node_set_local_transform requires the node id' };
    }
    const params = { id };
    if (Object.prototype.hasOwnProperty.call(args, 'position')) {
      params.position = args.position;
    }
    if (Object.prototype.hasOwnProperty.call(args, 'scale')) {
      params.scale = args.scale;
    }
    if (Object.prototype.hasOwnProperty.call(args, 'rotation')) {
      params.rotation = args.rotation;
    }
    return bridge.send('setNodeLocalTransform', params, Number(args.timeout_ms ?? 10000));
  },
  async scene_get_root_node(args) {
    return bridge.send('getSceneRootNode', {}, Number(args.timeout_ms ?? 10000));
  },
  async node_get_parent(args) {
    const id = typeof args.id === 'string' ? args.id.trim() : '';
    if (!id) {
      return { parentNode: null, err: 'node_get_parent requires the node id' };
    }
    return bridge.send('getParentNode', { id }, Number(args.timeout_ms ?? 10000));
  },
  async node_create(args) {
    const params = {};
    if (typeof args.parent_id === 'string' && args.parent_id.trim()) {
      params.parent_id = args.parent_id.trim();
    }
    return bridge.send('node_create', params, Number(args.timeout_ms ?? 10000));
  },
  async node_remove(args) {
    const id = typeof args.id === 'string' ? args.id.trim() : '';
    if (!id) {
      return { err: 'node_remove requires the node id' };
    }
    return bridge.send('removeNode', { id }, Number(args.timeout_ms ?? 10000));
  },
  async node_set_parent(args) {
    const id = typeof args.id === 'string' ? args.id.trim() : '';
    if (!id) {
      return { err: 'node_set_parent requires the node id' };
    }
    const parentId = typeof args.parent_id === 'string' ? args.parent_id.trim() : '';
    if (!parentId) {
      return { err: 'node_set_parent requires the parent_id' };
    }
    const transformMode =
      typeof args.transform_mode === 'string' && args.transform_mode.trim() ? args.transform_mode.trim() : 'preserve_world';
    if (!NODE_REPARENT_TRANSFORM_MODE_VALUES.includes(transformMode)) {
      return {
        err: `node_set_parent transform_mode must be one of: ${NODE_REPARENT_TRANSFORM_MODE_VALUES.join(', ')}`
      };
    }
    return bridge.send(
      'setParentNode',
      { id, parent_id: parentId, transform_mode: transformMode },
      Number(args.timeout_ms ?? 10000)
    );
  },
  async node_get_children(args) {
    const parent = typeof args.parent === 'string' ? args.parent.trim() : '';
    if (!parent) {
      return { subNodes: null, err: 'node_get_children requires the parent node id' };
    }
    return bridge.send('getSubNodes', { parent }, Number(args.timeout_ms ?? 10000));
  },
  async scene_get_selected_nodes(args) {
    return bridge.send('getSelectedNodes', {}, Number(args.timeout_ms ?? 10000));
  },
  async camera_get_active(args) {
    return bridge.send('camera_get_active', {}, Number(args.timeout_ms ?? 10000));
  },
  async camera_set_active(args) {
    const cameraId = typeof args.camera_id === 'string' ? args.camera_id.trim() : '';
    if (!cameraId) {
      return {
        camera: null,
        transform: null,
        direction: null,
        view_center: null,
        err: 'camera_set_active requires camera_id'
      };
    }
    return bridge.send('camera_set_active', { camera_id: cameraId }, Number(args.timeout_ms ?? 10000));
  },
  async camera_look_at(args) {
    if (!Array.isArray(args.target) || args.target.length !== 3) {
      return {
        camera: null,
        transform: null,
        direction: null,
        view_center: null,
        err: 'camera_look_at requires target as a 3-number world-space array'
      };
    }
    const params = {
      target: args.target
    };
    if (typeof args.camera_id === 'string' && args.camera_id.trim()) {
      params.camera_id = args.camera_id.trim();
    }
    if (Array.isArray(args.position)) {
      params.position = args.position;
    }
    if (Array.isArray(args.up)) {
      params.up = args.up;
    }
    return bridge.send('camera_look_at', params, Number(args.timeout_ms ?? 10000));
  },
  async model_generate_begin(args) {
    if (!args.spec || typeof args.spec !== 'object') {
      return { jobId: null, status: null, err: 'model_generate_begin requires spec' };
    }
    const destPath = typeof args.dest_path === 'string' ? args.dest_path.trim() : '';
    if (!destPath) {
      return { jobId: null, status: null, err: 'model_generate_begin requires dest_path' };
    }
    const params = {
      spec: normalizeGeneratedModelSpec(args.spec),
      dest_path: destPath
    };
    if (typeof args.name === 'string') {
      params.name = args.name;
    }
    if (Object.prototype.hasOwnProperty.call(args, 'create_node')) {
      params.create_node = !!args.create_node;
    }
    if (Object.prototype.hasOwnProperty.call(args, 'generation_timeout_ms')) {
      params.generation_timeout_ms = Number(args.generation_timeout_ms);
    }
    return bridge.send('model_generate_begin', params, Number(args.timeout_ms ?? 10000));
  },
  async model_generate_status(args) {
    const jobId = typeof args.job_id === 'string' ? args.job_id.trim() : '';
    if (!jobId) {
      return { job: null, err: 'model_generate_status requires job_id' };
    }
    return bridge.send('model_generate_status', { job_id: jobId }, Number(args.timeout_ms ?? 10000));
  },
  async model_generate_cancel(args) {
    const jobId = typeof args.job_id === 'string' ? args.job_id.trim() : '';
    if (!jobId) {
      return { jobId: null, status: null, err: 'model_generate_cancel requires job_id' };
    }
    return bridge.send('model_generate_cancel', { job_id: jobId }, Number(args.timeout_ms ?? 10000));
  },
  async editor_create_scene(args) {
    const params = {};
    if (typeof args.path === 'string' && args.path.trim()) {
      params.path = args.path.trim();
    }
    if (Object.prototype.hasOwnProperty.call(args, 'reset_view')) {
      params.reset_view = !!args.reset_view;
    }
    return bridge.send('createScene', params, Number(args.timeout_ms ?? 30000));
  },
  async editor_open_scene(args) {
    const path = typeof args.path === 'string' ? args.path.trim() : '';
    if (!path) {
      return { err: 'editor_open_scene requires path' };
    }
    const params = { path };
    if (Object.prototype.hasOwnProperty.call(args, 'reset_view')) {
      params.reset_view = !!args.reset_view;
    }
    return bridge.send('openScene', params, Number(args.timeout_ms ?? 30000));
  },
  async editor_save_scene(args) {
    return bridge.send('saveScene', {}, Number(args.timeout_ms ?? 30000));
  },
  async editor_call(args) {
    return bridge.send(String(args.method), args.params ?? {}, Number(args.timeout_ms ?? 30000));
  },
  async editor_eval(args) {
    return bridge.send(
      'eval',
      { script: String(args.script), expression: !!args.expression },
      Number(args.timeout_ms ?? 30000)
    );
  },
  async editor_screenshot(args) {
    return bridge.send('screenshot', { mime_type: args.mime_type ?? 'image/png' }, 30000);
  },
  async editor_console_logs(args) {
    return bridge.send('consoleLogs', { limit: Number(args.limit ?? 100) }, 10000);
  }
};

function isToolErrorResult(result) {
  return !!(
    result &&
    typeof result === 'object' &&
    Object.prototype.hasOwnProperty.call(result, 'err') &&
    result.err
  );
}

function formatToolResultText(result) {
  if (result === undefined) {
    return '';
  }
  if (isToolErrorResult(result)) {
    return String(result.err);
  }
  return JSON.stringify(result, null, 2);
}

function buildToolResultEnvelope(name, result) {
  // The renderer bridge snake-cases result keys, so the wire key is data_url.
  const screenshotDataUrl = result?.data_url ?? result?.dataUrl;
  if (name === 'editor_screenshot' && typeof screenshotDataUrl === 'string') {
    const comma = screenshotDataUrl.indexOf(',');
    const mime = /^data:([^;]+);base64,/.exec(screenshotDataUrl)?.[1] || 'image/png';
    const data = comma >= 0 ? screenshotDataUrl.slice(comma + 1) : screenshotDataUrl;
    return {
      structuredContent: {
        width: result.width,
        height: result.height,
        mimeType: mime
      },
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              width: result.width,
              height: result.height,
              mimeType: mime
            },
            null,
            2
          )
        },
        { type: 'image', data, mimeType: mime }
      ]
    };
  }
  const envelope = {
    structuredContent: result ?? null,
    content: [{ type: 'text', text: formatToolResultText(result) }]
  };
  if (isToolErrorResult(result)) {
    envelope.isError = true;
  }
  return envelope;
}

let stdinBuffer = Buffer.alloc(0);
let stdioResponseMode = 'jsonl';

function parseMessages() {
  while (true) {
    while (
      stdinBuffer.length > 0 &&
      (stdinBuffer[0] === 0x0d ||
        stdinBuffer[0] === 0x0a ||
        stdinBuffer[0] === 0x20 ||
        stdinBuffer[0] === 0x09)
    ) {
      stdinBuffer = stdinBuffer.slice(1);
    }
    if (stdinBuffer.length === 0) {
      return;
    }
    if (stdinBuffer[0] === 0x7b) {
      const newline = stdinBuffer.indexOf('\n');
      if (newline < 0) {
        return;
      }
      const line = stdinBuffer.slice(0, newline).toString('utf8').trim();
      stdinBuffer = stdinBuffer.slice(newline + 1);
      if (line.length > 0) {
        stdioResponseMode = 'jsonl';
        void handleIncomingRpc(JSON.parse(line), writeRpc);
      }
      continue;
    }

    const crlfMarker = stdinBuffer.indexOf('\r\n\r\n');
    const lfMarker = stdinBuffer.indexOf('\n\n');
    let marker = -1;
    let separatorLength = 0;
    if (crlfMarker >= 0 && (lfMarker < 0 || crlfMarker <= lfMarker)) {
      marker = crlfMarker;
      separatorLength = 4;
    } else if (lfMarker >= 0) {
      marker = lfMarker;
      separatorLength = 2;
    }
    if (marker < 0) {
      return;
    }
    const header = stdinBuffer.slice(0, marker).toString('utf8');
    const match = /^Content-Length:\s*(\d+)/im.exec(header);
    if (!match) {
      throw new Error('Missing Content-Length header');
    }
    const length = Number(match[1]);
    const bodyStart = marker + separatorLength;
    const bodyEnd = bodyStart + length;
    if (stdinBuffer.length < bodyEnd) {
      return;
    }
    const body = stdinBuffer.slice(bodyStart, bodyEnd).toString('utf8');
    stdinBuffer = stdinBuffer.slice(bodyEnd);
    stdioResponseMode = 'content-length';
    void handleIncomingRpc(JSON.parse(body), writeRpc);
  }
}

async function handleIncomingRpc(message, responder) {
  if (!message || typeof message !== 'object') {
    return;
  }
  if (!Object.prototype.hasOwnProperty.call(message, 'id')) {
    log(`MCP <- ${message.method ?? '<notification>'}`);
    return;
  }
  log(`MCP <- ${message.method ?? '<notification>'} #${message.id}`);
  try {
    const result = await dispatchRpc(message.method, message.params ?? {});
    responder({ jsonrpc: '2.0', id: message.id, result });
  } catch (err) {
    responder({
      jsonrpc: '2.0',
      id: message.id,
      error: {
        code: -32000,
        message: err instanceof Error ? err.message : String(err)
      }
    });
  }
}

function installStdioTransport() {
  process.stdin.on('data', (chunk) => {
    stdinBuffer = Buffer.concat([stdinBuffer, chunk]);
    parseMessages();
  });
}

function installIpcTransport() {
  parentPort?.on('message', (message) => {
    if (!message || typeof message !== 'object') {
      return;
    }
    if (message.type === 'rpc') {
      void handleIncomingRpc(message.message, (response) => {
        parentPort?.postMessage({
          type: 'rpcResult',
          requestId: message.requestId,
          response
        });
      });
      return;
    }
    if (message.type === 'rpcNotification') {
      void handleIncomingRpc(message.message, () => {});
      return;
    }
    if (message.type === 'shutdown') {
      void bridge.close().finally(() => {
        parentPort?.postMessage({ type: 'shutdown-complete' });
      });
    }
  });
}

async function dispatchRpc(method, params) {
  switch (method) {
    case 'initialize':
      return {
        protocolVersion: params.protocolVersion || '2024-11-05',
        capabilities: {
          tools: {},
          resources: {},
          prompts: {}
        },
        serverInfo: {
          name: 'zephyr3d-editor-mcp',
          version: '0.1.0'
        }
      };
    case 'tools/list':
      return { tools: TOOLS };
    case 'resources/list':
      return { resources: [] };
    case 'prompts/list':
      return { prompts: [] };
    case 'roots/list':
      return { roots: [] };
    case 'ping':
      return {};
    case 'tools/call': {
      const name = params.name;
      const args = params.arguments ?? {};
      const handler = handlers[name];
      if (!handler) {
        throw new Error(`Unknown tool: ${name}`);
      }
      const result = await handler(args);
      return buildToolResultEnvelope(name, result);
    }
    default:
      throw new Error(`Unsupported MCP method: ${method}`);
  }
}

function writeRpc(message) {
  const json = JSON.stringify(message);
  if (message && Object.prototype.hasOwnProperty.call(message, 'id')) {
    log(`MCP -> #${message.id}${message.error ? ' error' : ' ok'}`);
  }
  if (stdioResponseMode === 'content-length') {
    process.stdout.write(`Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n${json}`);
  } else {
    process.stdout.write(`${json}\n`);
  }
}

function log(message) {
  process.stderr.write(`${message}\n`);
}

if (IPC_TRANSPORT) {
  installIpcTransport();
} else {
  installStdioTransport();
}
