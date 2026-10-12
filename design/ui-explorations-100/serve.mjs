import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.zip': 'application/zip' };
const port = Number(process.env.L8DB_DESIGN_PORT || 4318);
const server = createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  if (request.method === 'POST' && /^\/_thumbnail\/\d{3}\.jpg$/.test(pathname)) {
    const chunks = [];
    let bytes = 0;
    for await (const chunk of request) {
      bytes += chunk.length;
      if (bytes > 1024 * 1024) { response.writeHead(413).end(); return; }
      chunks.push(chunk);
    }
    mkdirSync(join(root, 'thumbnails'), { recursive: true });
    writeFileSync(join(root, 'thumbnails', pathname.split('/').pop()), Buffer.concat(chunks));
    response.writeHead(201).end('saved');
    return;
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405).end(); return; }
  const file = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(root + sep) || !existsSync(file) || !statSync(file).isFile()) { response.writeHead(404).end('not found'); return; }
  response.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Content-Length': statSync(file).size });
  if (request.method === 'HEAD') response.end();
  else createReadStream(file).pipe(response);
});
server.listen(port, '127.0.0.1', () => console.log('Design gallery: http://127.0.0.1:' + port));
