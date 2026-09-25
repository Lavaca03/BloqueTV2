import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createDownloadService, downloadName, parsePlaylist } from '../lib/downloads.mjs';
import { isPrivateIp, safeRemoteUrl } from '../lib/remote.mjs';

const sample=Buffer.from('NexusMedia video fixture '.repeat(400));
const playlist='#EXTM3U\n#EXT-X-TARGETDURATION:5\n#EXTINF:5,\nfirst.ts\n#EXTINF:5,\nsecond.ts\n#EXT-X-ENDLIST\n';
let upstream,server,base,remoteBase;
let slowConnections=0;
before(async()=>{
 upstream=http.createServer((req,res)=>{
  const path=new URL(req.url,'http://fixture').pathname;
  if(path==='/video.mp4'||path==='/no-range.mp4'){
   res.setHeader('Content-Type','video/mp4');res.setHeader('Accept-Ranges','bytes');res.setHeader('ETag','"fixture-1"');
   const match=path!=='/no-range.mp4'&&req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);let start=0,end=sample.length-1;
   if(match){start=Number(match[1]);end=match[2]?Number(match[2]):end;if(start>=sample.length){res.writeHead(416,{'Content-Range':`bytes */${sample.length}`});res.end();return;}res.statusCode=206;res.setHeader('Content-Range',`bytes ${start}-${end}/${sample.length}`);}
   const body=sample.subarray(start,end+1);res.setHeader('Content-Length',body.length);res.end(body);return;
  }
  if(path==='/slow.mp4'){
   slowConnections++;res.setHeader('Content-Type','video/mp4');res.setHeader('Content-Length',1e7);res.setHeader('Accept-Ranges','bytes');res.flushHeaders();
   const timer=setInterval(()=>res.write(Buffer.alloc(16384)),40);res.on('close',()=>{clearInterval(timer);slowConnections--;});return;
  }
  if(path==='/error.mp4'){res.writeHead(200,{'Content-Type':'text/html'});res.end('<html>Provider error</html>');return;}
  if(path==='/dead.mp4'){res.writeHead(404);res.end();return;}
  if(path==='/embed'){res.writeHead(200,{'Content-Type':'text/html'});res.end('<video src="https://media.example/video.mp4"></video>');return;}
  if(path.endsWith('.m3u8')){
   res.setHeader('Content-Type','application/vnd.apple.mpegurl');
   if(path==='/master.m3u8')res.end('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=900\n/movie.m3u8\n');
   else if(path==='/encrypted.m3u8')res.end(playlist.replace('#EXTINF:5,','#EXT-X-KEY:METHOD=AES-128,URI="key"\n#EXTINF:5,'));
   else if(path==='/live.m3u8')res.end(playlist.replace('#EXT-X-ENDLIST',''));
   else if(path==='/audio.m3u8')res.end('#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",URI="audio.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=900,AUDIO="audio"\nmovie.m3u8');
   else if(path==='/broken.m3u8')res.end(playlist.replace('second.ts','missing.ts'));
   else if(path==='/fmp4.m3u8')res.end(playlist.replace('#EXT-X-TARGETDURATION:5','#EXT-X-TARGETDURATION:5\n#EXT-X-MAP:URI="init.mp4"').replaceAll('.ts','.m4s'));
   else res.end(playlist);return;
  }
  if(['/first.ts','/second.ts','/init.mp4','/first.m4s','/second.m4s'].includes(path)){res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':path.length});res.end(path);return;}
  res.writeHead(404);res.end();
 });
 upstream.listen(0,'127.0.0.1');await once(upstream,'listening');remoteBase=`http://127.0.0.1:${upstream.address().port}`;
 const service=createDownloadService({fetchRemote:async(raw,options)=>{const u=new URL(raw);return {response:await fetch(remoteBase+u.pathname,{headers:options.headers,signal:options.signal}),finalUrl:raw};},discoverMedia:html=>html.includes('<video')?[{url:'https://media.example/video.mp4',type:'mp4'}]:[]});
 server=http.createServer(async(req,res)=>{if(!await service.handle(req,res,new URL(req.url,`http://${req.headers.host}`))){res.writeHead(404);res.end();}});server.listen(0,'127.0.0.1');await once(server,'listening');base=`http://127.0.0.1:${server.address().port}`;
});
after(()=>{server.closeAllConnections();server.close();upstream.closeAllConnections();upstream.close();});
const prepare=async(path,filename='Prueba capítulo 1')=>{const r=await fetch(`${base}/api/download-info?${new URLSearchParams({url:'https://media.example'+path,filename})}`);return {status:r.status,...await r.json()};};
const status=async id=>(await fetch(`${base}/api/download-status?id=${id}`)).json();
async function waitState(id,wanted){for(let i=0;i<30;i++){const d=await status(id);if(wanted.includes(d.state))return d;await new Promise(r=>setTimeout(r,20));}throw new Error('State did not settle');}

test('direct video is downloaded with Unicode filename and byte integrity',async()=>{
 const info=await prepare('/video.mp4');assert.equal(info.status,200);assert.equal(info.filename,'Prueba capítulo 1.mp4');assert.equal(info.resumable,true);
 const r=await fetch(base+info.downloadUrl);assert.equal(r.status,200);assert.match(r.headers.get('content-disposition'),/filename\*=UTF-8''Prueba%20cap/);assert.deepEqual(Buffer.from(await r.arrayBuffer()),sample);
 const d=await waitState(info.id,['transferred']);assert.equal(d.bytes,sample.length);
});
test('range resume preserves 206, validators and exact bytes',async()=>{
 const info=await prepare('/video.mp4');const r=await fetch(base+info.downloadUrl,{headers:{Range:'bytes=99-'}});assert.equal(r.status,206);assert.equal(r.headers.get('content-range'),`bytes 99-${sample.length-1}/${sample.length}`);assert.deepEqual(Buffer.from(await r.arrayBuffer()),sample.subarray(99));assert.equal((await waitState(info.id,['transferred'])).bytes,sample.length);
});
test('a source ignoring Range restarts with HTTP 200 and the full file',async()=>{
 const info=await prepare('/no-range.mp4');const r=await fetch(base+info.downloadUrl,{headers:{Range:'bytes=99-'}});assert.equal(r.status,200);assert.deepEqual(Buffer.from(await r.arrayBuffer()),sample);
});
test('invalid ranges preserve 416 and are never marked transferred',async()=>{
 const info=await prepare('/video.mp4');const r=await fetch(base+info.downloadUrl,{headers:{Range:'bytes=999999-'}});assert.equal(r.status,416);assert.equal(r.headers.get('content-range'),`bytes */${sample.length}`);await r.text();assert.equal((await status(info.id)).state,'error');
});
test('master HLS is assembled in order, with accurate segment status',async()=>{
 const info=await prepare('/master.m3u8');assert.equal(info.status,200);assert.equal(info.filename,'Prueba capítulo 1.ts');const r=await fetch(base+info.downloadUrl);assert.equal(await r.text(),'/first.ts/second.ts');const d=await waitState(info.id,['transferred']);assert.equal(d.segments,2);assert.equal(d.totalSegments,2);
});
test('fragmented MP4 uses its init segment and .mp4 filename',async()=>{
 const info=await prepare('/fmp4.m3u8');assert.equal(info.filename,'Prueba capítulo 1.mp4');const r=await fetch(base+info.downloadUrl);assert.equal(await r.text(),'/init.mp4/first.m4s/second.m4s');
});
test('encrypted, live and separate audio HLS fail during preparation',async()=>{
 for(const path of ['/encrypted.m3u8','/live.m3u8','/audio.m3u8']){const d=await prepare(path);assert.equal(d.status,415,path);assert.ok(d.error);}
});
test('missing HLS segment interrupts stream and records an error',async()=>{
 const info=await prepare('/broken.m3u8');await assert.rejects(async()=>{const r=await fetch(base+info.downloadUrl);await r.arrayBuffer();});const d=await waitState(info.id,['error']);assert.match(d.error,/fragmento 2/);
});
test('HTML with a .mp4 name is rejected instead of saving a fake video',async()=>{
 const info=await prepare('/error.mp4');assert.equal(info.status,415);assert.equal(info.downloadUrl,undefined);
});
test('a public embed exposing a direct source can be resolved',async()=>{assert.equal((await prepare('/embed')).status,200);});
test('cancel aborts upstream promptly and status remains cancelled',async()=>{
 const info=await prepare('/slow.mp4');const transfer=await fetch(base+info.downloadUrl);const reader=transfer.body.getReader();await reader.read();
 const r=await fetch(`${base}/api/download-cancel?id=${info.id}`,{method:'POST'});assert.equal(r.status,200);assert.equal((await r.json()).state,'cancelled');await reader.cancel();assert.equal((await waitState(info.id,['cancelled'])).state,'cancelled');
 await new Promise(r=>setTimeout(r,100));assert.equal(slowConnections,0);
});
test('browser disconnection stops upstream without a phantom completion',async()=>{
 const info=await prepare('/slow.mp4');const transfer=await fetch(base+info.downloadUrl);const reader=transfer.body.getReader();await reader.read();await reader.cancel();const d=await waitState(info.id,['interrupted']);assert.equal(d.state,'interrupted');await new Promise(r=>setTimeout(r,50));assert.equal(slowConnections,0);
});
test('cross-origin cancellation and wrong methods are rejected',async()=>{
 const info=await prepare('/video.mp4');const r=await fetch(`${base}/api/download-cancel?id=${info.id}`,{method:'POST',headers:{Origin:'https://other.example'}});assert.equal(r.status,403);await r.text();const wrong=await fetch(`${base}/api/download-cancel?id=${info.id}`);assert.equal(wrong.status,405);await wrong.text();assert.equal((await status(info.id)).state,'ready');
});
test('unsafe networks and URL schemes are blocked, including mapped IPv6',async()=>{
 for(const ip of ['127.0.0.1','10.1.2.3','169.254.169.254','172.16.4.2','192.168.1.1','100.64.0.1','::1','::ffff:127.0.0.1','::ffff:7f00:1','fd00::1','fe80::1'])assert.equal(isPrivateIp(ip),true,ip);
 assert.equal(isPrivateIp('8.8.8.8'),false);assert.equal(isPrivateIp('2606:4700:4700::1111'),false);
 for(const url of ['file:///etc/passwd','http://127.1','http://[::ffff:7f00:1]/','http://user:pass@8.8.8.8/'])await assert.rejects(safeRemoteUrl(url));
});
test('filenames and unsupported playlist layouts are handled conservatively',()=>{
 assert.equal(downloadName('CON','https://media.example/video.mp4','video/mp4'),'_CON.mp4');assert.equal(downloadName('Parte 1.2','https://media.example/video','video/mp4'),'Parte 1.2.mp4');assert.equal(downloadName('../../hola.exe','https://media.example/video','video/mp4'),'.._.._hola.exe.mp4');
 assert.throws(()=>parsePlaylist(playlist.replace('#EXTINF:5,','#EXT-X-BYTERANGE:100\n#EXTINF:5,'),'https://media.example/movie.m3u8'));
});
