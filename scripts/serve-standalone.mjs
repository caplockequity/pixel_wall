#!/usr/bin/env node
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, join, extname, sep } from 'node:path';
const root = resolve(process.argv[2] ?? 'dist/standalone');
const port = Number(process.argv[3] ?? 4173);
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.wasm':'application/wasm'};
createServer(async (req,res) => {
 try {
  const url = new URL(req.url, 'http://localhost'); const decoded = decodeURIComponent(url.pathname);
  let path = resolve(root, '.' + decoded);
  if (path !== root && !path.startsWith(root+sep) || !['GET','HEAD'].includes(req.method)) {res.writeHead(404);res.end();return;}
  if ((await stat(path)).isDirectory()) path=join(path,'index.html');
  const body=await readFile(path);res.writeHead(200,{'Content-Type':types[extname(path)]??'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:body);
 } catch {res.writeHead(404);res.end('Not found');}
}).listen(port,'127.0.0.1',()=>console.log(`PixelWall standalone: http://127.0.0.1:${port}`));
