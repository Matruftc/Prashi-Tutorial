import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import handler from '../netlify/functions/portal.mjs';
import { statusPage } from '../lib/page-status.mjs';

const types = { html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8', jpg: 'image/jpeg', txt: 'text/plain; charset=utf-8', woff2: 'font/woff2' };
const appPaths = new Set(['/', '/portal', '/admin', '/login', '/reset']);
export function createPreviewServer(port, api = handler) {
  const origin = 'http://127.0.0.1:' + port;
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url, origin);
      const routed = url.pathname.startsWith('/api/') || ['/sitemap.xml', '/healthz', '/readyz'].includes(url.pathname)
        || /^\/(courses|resources)\//.test(url.pathname);
      if (routed) {
        const options = { method: req.method, headers: req.headers };
        if (req.method !== 'GET' && req.method !== 'HEAD') Object.assign(options, { body: Readable.toWeb(req), duplex: 'half' });
        const response = await api(new Request(new URL(url.pathname + url.search, origin), options), { ip: req.socket.remoteAddress });
        res.writeHead(response.status, Object.fromEntries(response.headers));
        if (response.body) Readable.fromWeb(response.body).pipe(res);
        else res.end();
        return;
      }
      const filename = ['/privacy', '/terms'].includes(url.pathname) ? url.pathname + '.html' : (appPaths.has(url.pathname) || /^\/(courses|resources)\/[a-z0-9-]+$/.test(url.pathname)) ? '/index.html' : url.pathname;
      if (!['GET', 'HEAD'].includes(req.method) || (!['/index.html', '/privacy.html', '/terms.html', '/robots.txt'].includes(filename) && !/^\/assets\/[a-z0-9-]+\.(?:css|js|jpg|woff2)$/.test(filename))) {
        const error = statusPage(404);
        res.writeHead(error.status, Object.fromEntries(error.headers)).end(req.method === 'HEAD' ? undefined : await error.text());
        return;
      }
      const file = await readFile(new URL('../site' + filename, import.meta.url));
      res.writeHead(200, { 'Content-Type': types[filename.split('.').at(-1)], 'X-Content-Type-Options': 'nosniff' }).end(req.method === 'HEAD' ? undefined : file);
    } catch (error) {
      const page = statusPage(error.code === 'ENOENT' ? 404 : 500);
      res.writeHead(page.status, Object.fromEntries(page.headers)).end(req.method === 'HEAD' ? undefined : await page.text());
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 8130);
  createPreviewServer(port).listen(port, '127.0.0.1', () => console.log('Prashi portal available at http://127.0.0.1:' + port));
}
