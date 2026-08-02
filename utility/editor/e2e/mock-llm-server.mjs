// Mock OpenAI-compatible /chat/completions server for assistant e2e tests.
// Scripted three-turn tool-calling run:
//   turn 1 -> tool_call shape_create_node (box)
//   turn 2 -> tool_call editor_screenshot
//   turn 3 -> asserts the request now carries the screenshot as an image_url
//             user message, then finishes with plain text.
// Every request body is appended to the log file for post-run assertions.
import http from 'node:http';
import fs from 'node:fs';

export function startMockLlmServer({ port, logPath }) {
  let turn = 0;
  const requests = [];

  function sseChunk(payload) {
    return `data: ${JSON.stringify(payload)}\n\n`;
  }

  function streamResponse(res, { content, toolCalls }) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache'
    });
    res.write(sseChunk({ choices: [{ delta: { role: 'assistant' } }] }));
    if (content) {
      for (const piece of content.match(/.{1,12}/gs) ?? []) {
        res.write(sseChunk({ choices: [{ delta: { content: piece } }] }));
      }
    }
    if (toolCalls) {
      toolCalls.forEach((call, index) => {
        res.write(
          sseChunk({
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index,
                      id: call.id,
                      type: 'function',
                      function: { name: call.name, arguments: '' }
                    }
                  ]
                }
              }
            ]
          })
        );
        res.write(
          sseChunk({
            choices: [
              {
                delta: {
                  tool_calls: [{ index, function: { arguments: JSON.stringify(call.args) } }]
                }
              }
            ]
          })
        );
      });
    }
    res.write('data: [DONE]\n\n');
    res.end();
  }

  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || !req.url?.includes('/chat/completions')) {
      res.writeHead(404).end();
      return;
    }
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      let payload = null;
      try {
        payload = JSON.parse(body);
      } catch {
        res.writeHead(400).end();
        return;
      }
      turn++;
      requests.push({ turn, payload });
      fs.appendFileSync(logPath, `${JSON.stringify({ turn, payload })}\n`);
      if (turn === 1) {
        streamResponse(res, {
          content: 'I will create a box first.',
          toolCalls: [
            { id: 'call_e2e_box', name: 'shape_create_node', args: { shape: 'box', name: 'E2EBox' } }
          ]
        });
      } else if (turn === 2) {
        streamResponse(res, {
          content: 'Now taking a screenshot to verify.',
          toolCalls: [{ id: 'call_e2e_shot', name: 'editor_screenshot', args: {} }]
        });
      } else {
        const sawImage = payload.messages.some(
          (message) =>
            message.role === 'user' &&
            Array.isArray(message.content) &&
            message.content.some(
              (item) =>
                item?.type === 'image_url' &&
                typeof item.image_url?.url === 'string' &&
                item.image_url.url.startsWith('data:image/')
            )
        );
        streamResponse(res, {
          content: sawImage
            ? 'E2E_SCREENSHOT_RECEIVED: I can see the box in the screenshot. Done.'
            : 'E2E_SCREENSHOT_MISSING: no screenshot image reached the model.'
        });
      }
    });
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve({ server, requests, getTurn: () => turn }));
  });
}
