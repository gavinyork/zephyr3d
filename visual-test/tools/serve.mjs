// Minimal static server for dist/. Exists so the harness page is served from
// http://127.0.0.1 rather than file:// or about:blank - WebGPU is only exposed
// in a secure context, and an opaque origin means no navigator.gpu at all.
// Deliberately dependency-free; there is nothing here worth a package for.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..', 'dist');
const port = Number(process.argv[2] ?? 4321);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ktx2': 'application/octet-stream',
  '.bin': 'application/octet-stream',
  '.glb': 'model/gltf-binary',
  '.hdr': 'application/octet-stream',
  '.dds': 'application/octet-stream'
};

http
  .createServer((req, res) => {
    const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
    // Chromium requests this unprompted on every navigation. Answering it keeps
    // the harness's console-error report meaningful - that report exists to
    // surface real engine errors, and a permanent favicon 404 in it trains the
    // reader to ignore the whole thing.
    if (url === '/favicon.ico') {
      res.writeHead(204).end();
      return;
    }
    const rel = url === '/' ? 'index.html' : url.replace(/^\/+/, '');
    const file = path.join(root, rel);
    // Contain traversal to dist/.
    if (!file.startsWith(root)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' }).end(`not found: ${rel}`);
        return;
      }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
        // Never let a stale bundle satisfy a test run.
        'Cache-Control': 'no-store'
      });
      res.end(data);
    });
  })
  .listen(port, '127.0.0.1', () => {
    console.log(`visual-test harness served at http://127.0.0.1:${port}/ (root: ${root})`);
  });
