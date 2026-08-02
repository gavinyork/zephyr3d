// End-to-end verification for the editor's AI enablement stack.
//
// Phase A (secure defaults): boots a headless editor with an isolated
// portable data dir and exercises the MCP HTTP surface directly:
// token auth, readOnlyHint annotations, unsafe-tool gating, scene edits,
// checkpoint/restore, and screenshot capture.
//
// Phase B (assistant loop): boots a second instance with unsafe tools
// enabled plus a mock OpenAI-compatible LLM server, drives the embedded
// chat assistant through editor_eval, and asserts the full loop:
// tool calls executed, screenshot fed back to the model as an image,
// tool_calls/toolCallId persisted, run finishing cleanly.
//
// Usage: node e2e/run-e2e.mjs   (from utility/editor, after npm run build:app)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { startMockLlmServer } from './mock-llm-server.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const editorRoot = path.resolve(__dirname, '..');
// Resolve the electron executable directly (require('electron') from plain
// Node returns the binary path) so the spawned pid is the real electron main
// process and taskkill /T can reliably tear the whole tree down.
const electronBin = createRequire(path.join(editorRoot, 'package.json'))('electron');
const MCP_PORT = 47861;
const MOCK_LLM_PORT = 47862;
const MCP_TOKEN = 'e2e_token_0123456789abcdef';
const tmpRoot = path.join(editorRoot, 'e2e', '.tmp');
const results = [];
let failures = 0;

function check(name, condition, detail = '') {
  results.push({ name, ok: !!condition, detail });
  if (!condition) {
    failures++;
  }
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail && !condition ? ` -- ${detail}` : ''}`);
}

function rmrf(target) {
  fs.rmSync(target, { recursive: true, force: true });
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let rpcId = 0;
async function mcp(method, params = {}, { token = MCP_TOKEN, raw = false } = {}) {
  const response = await fetch(`http://127.0.0.1:${MCP_PORT}/mcp${token ? `?token=${token}` : ''}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: `e2e_${++rpcId}`, method, params })
  });
  if (raw) {
    return response;
  }
  if (!response.ok) {
    throw new Error(`MCP HTTP ${response.status} for ${method}`);
  }
  const payload = await response.json();
  if (payload.error) {
    throw new Error(`MCP error for ${method}: ${payload.error.message}`);
  }
  return payload.result;
}

async function callTool(name, args = {}) {
  const result = await mcp('tools/call', { name, arguments: args });
  return result;
}

function structured(result) {
  return result?.structuredContent ?? null;
}

async function evalInEditor(script, timeoutMs = 30000) {
  const result = await callTool('editor_eval', { script, timeout_ms: timeoutMs });
  if (result?.isError) {
    throw new Error(`editor_eval failed: ${JSON.stringify(result.content ?? result).slice(0, 400)}`);
  }
  return structured(result) ?? result;
}

function launchEditor({ userDataDir, extraEnv = {} }) {
  fs.mkdirSync(userDataDir, { recursive: true });
  // Note: the headless CLI only accepts the space-separated flag form
  // (`--mcp-port <port>`), not `--mcp-port=<port>`.
  const child = spawn(electronBin, ['.', '--headless', '--mcp-port', String(MCP_PORT)], {
    cwd: editorRoot,
    env: {
      ...process.env,
      ZEPHYR_EDITOR_PORTABLE: '1',
      ZEPHYR_EDITOR_PORTABLE_DIR: userDataDir,
      ZEPHYR_EDITOR_MCP_TOKEN: MCP_TOKEN,
      ZEPHYR_EDITOR_LOG_PATH: path.join(userDataDir, 'editor.log'),
      ...extraEnv
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', (chunk) => (output += chunk));
  child.stderr.on('data', (chunk) => (output += chunk));
  return { child, getOutput: () => output };
}

async function waitForMcp(instance, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await mcp('initialize', { protocolVersion: '2024-11-05', capabilities: {} });
      return;
    } catch {
      await sleep(1000);
    }
  }
  console.error('--- editor output on MCP startup failure ---');
  console.error(instance?.getOutput?.().slice(-3000) ?? '(no output captured)');
  throw new Error('MCP service did not come up in time');
}

async function stopEditor(instance) {
  if (!instance) {
    return;
  }
  try {
    instance.child.kill();
  } catch {
    /* ignore */
  }
  if (process.platform === 'win32' && instance.child.pid) {
    await new Promise((resolve) => {
      const killer = spawn('taskkill', ['/pid', String(instance.child.pid), '/T', '/F'], {
        stdio: 'ignore'
      });
      killer.on('exit', resolve);
      killer.on('error', resolve);
    });
  }
  await sleep(1500);
}

async function phaseA() {
  console.log('\n=== Phase A: MCP surface, auth, checkpoint/restore ===');
  const userDataDir = path.join(tmpRoot, 'userdata-a');
  const instance = launchEditor({ userDataDir });
  try {
    await waitForMcp(instance);
    check('A: MCP service reachable with token', true);

    const noToken = await mcp('tools/list', {}, { token: '', raw: true });
    check('A: request without token rejected with 401', noToken.status === 401, `status=${noToken.status}`);
    const badToken = await mcp('tools/list', {}, { token: 'wrong_token_0123456789', raw: true });
    check('A: request with wrong token rejected with 401', badToken.status === 401, `status=${badToken.status}`);

    const toolsResult = await mcp('tools/list');
    const tools = toolsResult.tools ?? [];
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    check('A: tools/list returns catalog', tools.length > 40, `count=${tools.length}`);
    check('A: scene_checkpoint tool published', byName.has('scene_checkpoint'));
    check('A: scene_restore tool published', byName.has('scene_restore'));
    check('A: asset_read_file re-published', byName.has('asset_read_file'));
    check('A: hidden tools not listed', !byName.has('editor_eval') && !byName.has('editor_call'));
    check(
      'A: readOnlyHint true on scene_get_root_node',
      byName.get('scene_get_root_node')?.annotations?.readOnlyHint === true
    );
    check(
      'A: readOnlyHint false on node_create',
      byName.get('node_create')?.annotations?.readOnlyHint === false
    );

    let evalBlocked = false;
    let evalDetail = 'call unexpectedly succeeded';
    try {
      await callTool('editor_eval', { script: 'return 1;', expression: false });
    } catch (err) {
      evalBlocked = String(err).includes('disabled');
      evalDetail = String(err).slice(0, 200);
    }
    check('A: editor_eval blocked by default', evalBlocked, evalDetail);

    await callTool('editor_wait_ready', { timeout_ms: 120000 });
    check('A: editor_wait_ready succeeded', true);

    const projectDir = path.join(tmpRoot, 'project-a');
    rmrf(projectDir);
    const created = structured(await callTool('project_create', { name: 'E2EProjectA', path: projectDir }));
    check('A: project_create succeeded', !created?.err && !!created?.id, JSON.stringify(created));

    const box = structured(await callTool('shape_create_node', { shape: 'box', name: 'BoxA' }));
    check('A: shape_create_node succeeded', !box?.err, JSON.stringify(box));

    const root = structured(await callTool('scene_get_root_node', {}));
    const rootId = root?.node?.id;
    check('A: scene_get_root_node returned root', !!rootId, JSON.stringify(root));
    const childrenBefore = structured(await callTool('node_get_children', { parent: rootId }));
    const countBefore = (childrenBefore?.sub_nodes ?? childrenBefore?.subNodes)?.length ?? -1;

    const checkpoint = structured(await callTool('scene_checkpoint', { label: 'e2e' }));
    check('A: scene_checkpoint succeeded', !checkpoint?.err && !!checkpoint?.checkpoint?.id, JSON.stringify(checkpoint));

    const sphere = structured(await callTool('shape_create_node', { shape: 'sphere', name: 'SphereA' }));
    check('A: second shape created', !sphere?.err, JSON.stringify(sphere));
    const childrenMid = structured(await callTool('node_get_children', { parent: rootId }));
    check(
      'A: node count increased after edit',
      ((childrenMid?.sub_nodes ?? childrenMid?.subNodes)?.length ?? -1) === countBefore + 1,
      `before=${countBefore} mid=${(childrenMid?.sub_nodes ?? childrenMid?.subNodes)?.length}`
    );

    const restored = structured(await callTool('scene_restore', {}));
    check('A: scene_restore succeeded', !restored?.err && !!restored?.restored, JSON.stringify(restored));
    const rootAfter = structured(await callTool('scene_get_root_node', {}));
    const childrenAfter = structured(await callTool('node_get_children', { parent: rootAfter?.node?.id }));
    check(
      'A: node count reverted after restore',
      ((childrenAfter?.sub_nodes ?? childrenAfter?.subNodes)?.length ?? -1) === countBefore,
      `before=${countBefore} after=${(childrenAfter?.sub_nodes ?? childrenAfter?.subNodes)?.length}`
    );

    const shot = await callTool('editor_screenshot', {});
    const imageBlock = (shot.content ?? []).find((block) => block.type === 'image');
    check(
      'A: editor_screenshot returned image block',
      !!imageBlock?.data && imageBlock.data.length > 1000,
      `blocks=${JSON.stringify((shot.content ?? []).map((b) => b.type))}`
    );
  } finally {
    await stopEditor(instance);
  }
}

async function phaseB() {
  console.log('\n=== Phase B: embedded assistant loop against mock LLM ===');
  const userDataDir = path.join(tmpRoot, 'userdata-b');
  const llmLogPath = path.join(tmpRoot, 'mock-llm-requests.jsonl');
  rmrf(llmLogPath);
  fs.mkdirSync(tmpRoot, { recursive: true });
  fs.writeFileSync(llmLogPath, '');
  const mock = await startMockLlmServer({ port: MOCK_LLM_PORT, logPath: llmLogPath });
  const instance = launchEditor({
    userDataDir,
    extraEnv: { EDITOR_MCP_ENABLE_UNSAFE_TOOLS: '1' }
  });
  try {
    await waitForMcp(instance);
    await callTool('editor_wait_ready', { timeout_ms: 120000 });
    const projectDir = path.join(tmpRoot, 'project-b');
    rmrf(projectDir);
    const created = structured(await callTool('project_create', { name: 'E2EProjectB', path: projectDir }));
    check('B: project_create succeeded', !created?.err, JSON.stringify(created));

    const configured = await evalInEditor(`
      const settings = window.zephyrEditorDesktop.settings;
      await settings.saveGlobalSettings({
        llm: {
          provider: 'custom',
          baseUrl: 'http://127.0.0.1:${MOCK_LLM_PORT}/v1',
          model: 'mock-model-1',
          temperature: 0.2,
          maxOutputTokens: 4096,
          maxToolSteps: 16,
          toolCalling: true,
          requireToolApproval: false
        }
      });
      await settings.setLlmApiKey('custom', 'e2e-dummy-key');
      const session = await settings.createAssistantSession('E2E Run', null);
      await settings.sendAssistantMessage(session.id, 'Create a box and verify it with a screenshot.', [], null);
      return session.id;
    `);
    const sessionId =
      typeof configured === 'string'
        ? configured
        : (configured?.result ?? configured?.value ?? JSON.stringify(configured));
    check('B: assistant session started', typeof sessionId === 'string' && sessionId.length > 0, String(sessionId));

    let messages = null;
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      await sleep(2000);
      const state = await evalInEditor(`
        const settings = window.zephyrEditorDesktop.settings;
        const sessions = await settings.listAssistantSessions(null);
        const session = sessions.find((item) => item.id === ${JSON.stringify(sessionId)});
        const messages = await settings.getAssistantSessionMessages(${JSON.stringify(sessionId)}, null);
        return { active: !!session?.active, messages };
      `);
      if (state && state.active === false && (state.messages?.length ?? 0) > 1) {
        messages = state.messages;
        break;
      }
    }
    check('B: assistant run completed', Array.isArray(messages), 'run did not finish within 120s');
    if (Array.isArray(messages)) {
      const assistantWithToolCalls = messages.filter(
        (message) => message.role === 'assistant' && ((message.toolCalls ?? message.tool_calls)?.length ?? 0) > 0
      );
      const toolResults = messages.filter((message) => message.role === 'tool' && (message.toolCallId ?? message.tool_call_id));
      const syntheticScreens = messages.filter(
        (message) => message.synthetic === true && (message.attachments?.length ?? 0) > 0
      );
      const finalText = messages
        .filter((message) => message.role === 'assistant')
        .map((message) => message.content)
        .join('\n');
      check('B: assistant tool_calls persisted', assistantWithToolCalls.length >= 2, `count=${assistantWithToolCalls.length}`);
      check('B: tool results persisted with toolCallId', toolResults.length >= 2, `count=${toolResults.length}`);
      check('B: synthetic screenshot message persisted', syntheticScreens.length >= 1, `count=${syntheticScreens.length}`);
      check(
        'B: model confirmed it received the screenshot image',
        finalText.includes('E2E_SCREENSHOT_RECEIVED'),
        finalText.slice(-300)
      );
    }
    const llmRequests = fs
      .readFileSync(llmLogPath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    check('B: mock LLM saw 3 turns', llmRequests.length === 3, `turns=${llmRequests.length}`);
    const lastRequest = llmRequests[llmRequests.length - 1]?.payload;
    const hasEditorSnapshot = (lastRequest?.messages ?? []).some(
      (message) =>
        message.role === 'system' &&
        typeof message.content === 'string' &&
        message.content.includes('Editor state snapshot')
    );
    check('B: editor state snapshot injected into context', hasEditorSnapshot);
    const hasToolPairing = (lastRequest?.messages ?? []).some(
      (message) => message.role === 'tool' && message.tool_call_id
    );
    check('B: tool results replayed with tool_call_id', hasToolPairing);

    const box = structured(await callTool('scene_get_root_node', {}));
    const children = structured(await callTool('node_get_children', { parent: box?.node?.id }));
    const hasBox = ((children?.sub_nodes ?? children?.subNodes) ?? []).some((node) => /box/i.test(node.name ?? ''));
    check('B: box actually exists in the scene', hasBox, JSON.stringify(children?.sub_nodes ?? children?.subNodes));
  } finally {
    await stopEditor(instance);
    mock.server.close();
  }
}

async function main() {
  rmrf(tmpRoot);
  fs.mkdirSync(tmpRoot, { recursive: true });
  const startedAt = Date.now();
  try {
    await phaseA();
    await phaseB();
  } catch (err) {
    check('unhandled e2e error', false, String(err?.stack ?? err));
  }
  const seconds = Math.round((Date.now() - startedAt) / 1000);
  console.log(`\n=== E2E summary: ${results.length - failures}/${results.length} passed in ${seconds}s ===`);
  if (failures === 0) {
    // Keep .tmp (isolated userdata, editor logs, mock LLM request log) only
    // when something failed, for post-mortem debugging.
    rmrf(tmpRoot);
  } else {
    console.log(`Artifacts kept for debugging: ${tmpRoot}`);
  }
  process.exit(failures ? 1 : 0);
}

main();
