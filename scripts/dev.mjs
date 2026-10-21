import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve('web/dist');
http.createServer(async (req,res) => {
  try {
    const file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
    if (!file.startsWith(root + '/') && file !== root) throw new Error('Path');
    const target = file === root || file.endsWith('/') ? path.join(file,'index.html') : file;
    const ext = path.extname(target);
    res.setHeader('Content-Type', {'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.map':'application/json'}[ext] || 'application/octet-stream');
    res.end(await readFile(target));
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(4177,'127.0.0.1',()=>console.log('Foldnote preview http://127.0.0.1:4177'));
