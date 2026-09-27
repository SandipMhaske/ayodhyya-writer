// Tiny static file server (Node built-ins only) for admin UI + generated dist preview.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.xml': 'application/xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon' };

export function serve({ root, port, spa = false }) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://local');
    let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    let file = path.join(root, rel);
    if (url.pathname.endsWith('/')) file = path.join(file, 'index.html');
    fs.stat(file, (err, st) => {
      if (!err && st.isDirectory()) file = path.join(file, 'index.html');
      fs.readFile(file, (e2, data) => {
        if (e2) {
          if (spa) {
            fs.readFile(path.join(root, 'index.html'), (e3, d3) => {
              if (e3) { res.writeHead(404); res.end('Not found'); } else { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(d3); }
            });
          } else {
            fs.readFile(path.join(root, '404.html'), (e3, d3) => {
              res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
              res.end(d3 || 'Not found');
            });
          }
          return;
        }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
        res.end(data);
      });
    });
  });
  server.listen(port, () => console.log(`Serving ${root} → http://localhost:${port}/`));
  return server;
}
