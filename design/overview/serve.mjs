import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const types={'.html':'text/html; charset=utf-8','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2','.zip':'application/zip','.csv':'text/csv; charset=utf-8'};
const server=createServer((request,response)=>{
  if(request.method!=='GET'&&request.method!=='HEAD'){response.writeHead(405).end();return;}
  let pathname;
  try{pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname);}catch{response.writeHead(400).end();return;}
  const file=resolve(root,'.'+(pathname==='/'?'/overview/index.html':pathname));
  if(!file.startsWith(root+sep)||!existsSync(file)||!statSync(file).isFile()){response.writeHead(404).end('not found');return;}
  response.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Content-Length':statSync(file).size,'Cache-Control':'no-cache'});
  if(request.method==='HEAD')response.end();else createReadStream(file).pipe(response);
});
server.listen(4320,'127.0.0.1',()=>console.log('Design overview: http://127.0.0.1:4320/overview/index.html'));
