#!/usr/bin/env node
import crypto from 'node:crypto';
import net from 'node:net';
import process from 'node:process';

const DEFAULT_PORT = Number(process.env.EDITOR_MCP_PORT || 47231);
const BRIDGE_TOKEN = process.env.EDITOR_MCP_TOKEN || crypto.randomBytes(12).toString('hex');
const DEFAULT_EDITOR_URL = process.env.EDITOR_URL || 'http://127.0.0.1:8000/dist/index.html';

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
            frameBuffer = this.processFrames(socket, frameBuffer);
          }
        } catch (err) {
          socket.destroy();
          log(`WebSocket handshake failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        return;
      }
      frameBuffer = Buffer.concat([frameBuffer, chunk]);
      frameBuffer = this.processFrames(socket, frameBuffer);
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

  processFrames(socket, buffer) {
    let offset = 0;
    while (buffer.length - offset >= 2) {
      const first = buffer[offset];
      const second = buffer[offset + 1];
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
      if (opcode === 0x1) {
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
      throw new Error('No editor page is connected. Open the editor URL returned by editor_connect_info.');
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

const tools = [
  {
    name: 'editor_connect_info',
    description: 'Return the URL that opens the editor with the MCP bridge enabled.',
    inputSchema: {
      type: 'object',
      properties: {
        baseUrl: { type: 'string', description: 'Editor URL, defaulting to EDITOR_URL or local web-dev-server.' },
        device: { type: 'string', description: 'Optional renderer query value such as webgl2 or webgpu.' },
        project: { type: 'string', description: 'Optional project id/path query value.' },
        remote: { type: 'boolean', description: 'Set the editor remote project flag.' },
        open: { type: 'boolean', description: 'Set the editor open project flag.' }
      }
    }
  },
  {
    name: 'editor_wait_ready',
    description: 'Wait until an editor browser page connects to this MCP server.',
    inputSchema: {
      type: 'object',
      properties: {
        timeoutMs: { type: 'number', default: 30000 }
      }
    }
  },
  {
    name: 'editor_status',
    description: 'Get editor, project, scene, canvas, and device status.',
    inputSchema: { type: 'object', properties: {} }
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
      'Create a new editor project with the given name and open it. Returns id with the new project uuid on success, or null id and err on failure.',
    inputSchema: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string', description: 'Name for the new project.' },
        saveSceneChanges: {
          type: 'boolean',
          description: 'Save the current dirty scene before creating the project. Fails if the scene has no path.'
        },
        discardSceneChanges: {
          type: 'boolean',
          description: 'Discard current dirty scene changes before creating the project.'
        },
        timeoutMs: { type: 'number', default: 30000 }
      }
    }
  },
  {
    name: 'project_open',
    description:
      'Open an existing editor project by project id. Returns id with the opened project uuid on success, or null id and err on failure.',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', description: 'Project uuid to open.' },
        saveSceneChanges: {
          type: 'boolean',
          description: 'Save the current dirty scene before opening the project. Fails if the scene has no path.'
        },
        discardSceneChanges: {
          type: 'boolean',
          description: 'Discard current dirty scene changes before opening the project.'
        },
        timeoutMs: { type: 'number', default: 30000 }
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
        saveSceneChanges: {
          type: 'boolean',
          description: 'Save the current dirty scene before closing the project. Fails if the scene has no path.'
        },
        discardSceneChanges: {
          type: 'boolean',
          description: 'Discard current dirty scene changes before closing the project.'
        },
        timeoutMs: { type: 'number', default: 30000 }
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
        saveSceneChanges: {
          type: 'boolean',
          description: 'Save the current dirty scene before exporting the project. Fails if the scene has no path.'
        },
        discardSceneChanges: {
          type: 'boolean',
          description: 'Export without saving current dirty scene changes.'
        },
        timeoutMs: { type: 'number', default: 60000 }
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
        saveSceneChanges: {
          type: 'boolean',
          description: 'Save the current dirty scene before deleting the project. Fails if the scene has no path.'
        },
        discardSceneChanges: {
          type: 'boolean',
          description: 'Discard current dirty scene changes before deleting the project.'
        },
        timeoutMs: { type: 'number', default: 30000 }
      }
    }
  },
  {
    name: 'getNodeClasses',
    description: 'Get the list of scene node classes that can be reported by the editor bridge.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'createShapeNode',
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
        parentId: {
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
        timeoutMs: { type: 'number', default: 10000 }
      }
    }
  },
  {
    name: 'getNodeClass',
    description:
      'Get the class of a scene node by persistent node id. Returns { nodeClass, err } where nodeClass is null on error.',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', description: 'Persistent id of the scene node.' },
        timeoutMs: { type: 'number', default: 10000 }
      }
    }
  },
  {
    name: 'getNodeLocalTransform',
    description:
      'Get a scene node local transform relative to its parent. Returns position, scale, and rotation quaternion arrays.',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', description: 'Persistent id of the scene node.' },
        timeoutMs: { type: 'number', default: 10000 }
      }
    }
  },
  {
    name: 'setNodeLocalTransform',
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
        timeoutMs: { type: 'number', default: 10000 }
      }
    }
  },
  {
    name: 'getSceneRootNode',
    description: 'Get the current scene root node. Returns { node: { id, name }, err }.',
    inputSchema: {
      type: 'object',
      properties: {
        timeoutMs: { type: 'number', default: 10000 }
      }
    }
  },
  {
    name: 'getParentNode',
    description: 'Get the parent node id of a scene node by persistent node id. Returns { parentNode, err }.',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', description: 'Persistent id of the scene node.' },
        timeoutMs: { type: 'number', default: 10000 }
      }
    }
  },
  {
    name: 'getSubNodes',
    description: 'Get direct child nodes of a scene node. Returns { subNodes: [{ id, name }], err }.',
    inputSchema: {
      type: 'object',
      required: ['parent'],
      properties: {
        parent: { type: 'string', description: 'Persistent id of the parent scene node.' },
        timeoutMs: { type: 'number', default: 10000 }
      }
    }
  },
  {
    name: 'editor_call',
    description: 'Call a built-in browser bridge method such as createScene, openScene, renderFrames, screenshot, consoleLogs.',
    inputSchema: {
      type: 'object',
      required: ['method'],
      properties: {
        method: { type: 'string' },
        params: { type: 'object' },
        timeoutMs: { type: 'number', default: 30000 }
      }
    }
  },
  {
    name: 'editor_eval',
    description: 'Run JavaScript in the editor page. The script receives editor, controller, scene, getDevice, getEngine, and args bindings.',
    inputSchema: {
      type: 'object',
      required: ['script'],
      properties: {
        script: { type: 'string' },
        expression: { type: 'boolean', default: false },
        timeoutMs: { type: 'number', default: 30000 }
      }
    }
  },
  {
    name: 'editor_render_frames',
    description: 'Advance and render one or more editor frames.',
    inputSchema: {
      type: 'object',
      properties: {
        frames: { type: 'number', default: 1 }
      }
    }
  },
  {
    name: 'editor_screenshot',
    description: 'Capture the editor canvas as a PNG data URL.',
    inputSchema: {
      type: 'object',
      properties: {
        mimeType: { type: 'string', default: 'image/png' }
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

const handlers = {
  async editor_connect_info(args) {
    const base = args.baseUrl || DEFAULT_EDITOR_URL;
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
    const client = await bridge.waitForClient(Number(args.timeoutMs ?? 30000));
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
    return bridge.send(
      'createProject',
      {
        name,
        saveSceneChanges: !!args.saveSceneChanges,
        discardSceneChanges: !!args.discardSceneChanges
      },
      Number(args.timeoutMs ?? 30000)
    );
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
        saveSceneChanges: !!args.saveSceneChanges,
        discardSceneChanges: !!args.discardSceneChanges
      },
      Number(args.timeoutMs ?? 30000)
    );
  },
  async project_close(args) {
    return bridge.send(
      'closeProject',
      {
        saveSceneChanges: !!args.saveSceneChanges,
        discardSceneChanges: !!args.discardSceneChanges
      },
      Number(args.timeoutMs ?? 30000)
    );
  },
  async project_export(args) {
    return bridge.send(
      'exportProject',
      {
        saveSceneChanges: !!args.saveSceneChanges,
        discardSceneChanges: !!args.discardSceneChanges
      },
      Number(args.timeoutMs ?? 60000)
    );
  },
  async project_delete(args) {
    return bridge.send(
      'deleteProject',
      {
        saveSceneChanges: !!args.saveSceneChanges,
        discardSceneChanges: !!args.discardSceneChanges
      },
      Number(args.timeoutMs ?? 30000)
    );
  },
  async getNodeClasses(args) {
    return bridge.send('getNodeClasses', {}, Number(args.timeoutMs ?? 10000));
  },
  async createShapeNode(args) {
    const shape = typeof args.shape === 'string' ? args.shape.trim() : '';
    if (!shape) {
      return { node: null, transform: null, err: 'createShapeNode requires the shape type' };
    }
    const params = { shape };
    if (typeof args.parentId === 'string' && args.parentId.trim()) {
      params.parentId = args.parentId.trim();
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
    return bridge.send('createShapeNode', params, Number(args.timeoutMs ?? 10000));
  },
  async getNodeClass(args) {
    const id = typeof args.id === 'string' ? args.id.trim() : '';
    if (!id) {
      return { nodeClass: null, err: 'getNodeClass requires the node id' };
    }
    return bridge.send('getNodeClass', { id }, Number(args.timeoutMs ?? 10000));
  },
  async getNodeLocalTransform(args) {
    const id = typeof args.id === 'string' ? args.id.trim() : '';
    if (!id) {
      return { transform: null, err: 'getNodeLocalTransform requires the node id' };
    }
    return bridge.send('getNodeLocalTransform', { id }, Number(args.timeoutMs ?? 10000));
  },
  async setNodeLocalTransform(args) {
    const id = typeof args.id === 'string' ? args.id.trim() : '';
    if (!id) {
      return { transform: null, err: 'setNodeLocalTransform requires the node id' };
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
    return bridge.send('setNodeLocalTransform', params, Number(args.timeoutMs ?? 10000));
  },
  async getSceneRootNode(args) {
    return bridge.send('getSceneRootNode', {}, Number(args.timeoutMs ?? 10000));
  },
  async getParentNode(args) {
    const id = typeof args.id === 'string' ? args.id.trim() : '';
    if (!id) {
      return { parentNode: null, err: 'getParentNode requires the node id' };
    }
    return bridge.send('getParentNode', { id }, Number(args.timeoutMs ?? 10000));
  },
  async getSubNodes(args) {
    const parent = typeof args.parent === 'string' ? args.parent.trim() : '';
    if (!parent) {
      return { subNodes: null, err: 'getSubNodes requires the parent node id' };
    }
    return bridge.send('getSubNodes', { parent }, Number(args.timeoutMs ?? 10000));
  },
  async editor_call(args) {
    return bridge.send(String(args.method), args.params ?? {}, Number(args.timeoutMs ?? 30000));
  },
  async editor_eval(args) {
    return bridge.send(
      'eval',
      { script: String(args.script), expression: !!args.expression },
      Number(args.timeoutMs ?? 30000)
    );
  },
  async editor_render_frames(args) {
    return bridge.send('renderFrames', { frames: Number(args.frames ?? 1) }, 30000);
  },
  async editor_screenshot(args) {
    return bridge.send('screenshot', { mimeType: args.mimeType ?? 'image/png' }, 30000);
  },
  async editor_console_logs(args) {
    return bridge.send('consoleLogs', { limit: Number(args.limit ?? 100) }, 10000);
  }
};

let stdinBuffer = Buffer.alloc(0);
let stdioResponseMode = 'jsonl';
process.stdin.on('data', (chunk) => {
  stdinBuffer = Buffer.concat([stdinBuffer, chunk]);
  parseMessages();
});

function parseMessages() {
  while (true) {
    while (
      stdinBuffer.length > 0 &&
      (stdinBuffer[0] === 0x0d || stdinBuffer[0] === 0x0a || stdinBuffer[0] === 0x20 || stdinBuffer[0] === 0x09)
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
        void handleRpc(JSON.parse(line));
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
    void handleRpc(JSON.parse(body));
  }
}

async function handleRpc(message) {
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
    writeRpc({ jsonrpc: '2.0', id: message.id, result });
  } catch (err) {
    writeRpc({
      jsonrpc: '2.0',
      id: message.id,
      error: {
        code: -32000,
        message: err instanceof Error ? err.message : String(err)
      }
    });
  }
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
      return { tools };
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
      if (name === 'editor_screenshot' && typeof result?.dataUrl === 'string') {
        const comma = result.dataUrl.indexOf(',');
        const mime = /^data:([^;]+);base64,/.exec(result.dataUrl)?.[1] || 'image/png';
        const data = comma >= 0 ? result.dataUrl.slice(comma + 1) : result.dataUrl;
        return {
          content: [
            { type: 'text', text: JSON.stringify({ width: result.width, height: result.height }, null, 2) },
            { type: 'image', data, mimeType: mime }
          ]
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
      };
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
