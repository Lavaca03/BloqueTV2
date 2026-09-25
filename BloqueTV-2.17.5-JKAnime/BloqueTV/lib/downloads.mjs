import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { once } from 'node:events';
import { readTextLimited } from './remote.mjs';

const fail=(message,status=415)=>Object.assign(new Error(message),{status});
const MEDIA_EXT=/\.(mp4|m4v|webm|mov|mkv|ts|mp3|m4a|aac|ogg|wav|flac)$/i;
const agent='Mozilla/5.0 BloqueTV/2.17.2';
const mediaHeaders=referer=>({'user-agent':agent,accept:'video/*,audio/*,application/vnd.apple.mpegurl,text/html;q=0.8,*/*;q=0.5',...(referer?{referer}:{})});
const cancel=response=>response?.body?.cancel().catch(()=>{});

export function downloadName(requested,url,contentType,forced='') {
  const types={'video/mp4':'.mp4','video/webm':'.webm','video/quicktime':'.mov','video/x-m4v':'.m4v','video/x-matroska':'.mkv','video/mp2t':'.ts','audio/mpeg':'.mp3','audio/mp4':'.m4a','audio/aac':'.aac','audio/ogg':'.ogg','audio/wav':'.wav','audio/flac':'.flac'};
  const extension=forced||types[contentType?.split(';')[0].trim()]||new URL(url).pathname.match(MEDIA_EXT)?.[0]||'.mp4';
  let name=String(requested||'BloqueTV').normalize('NFKC').replace(/[\x00-\x1f\x7f<>:"/\\|?*]/g,'_').replace(/\s+/g,' ').trim().replace(/[. ]+$/g,'').slice(0,135)||'BloqueTV';
  if(MEDIA_EXT.test(name)||/\.(m3u8|bin)$/i.test(name)) name=name.slice(0,-extname(name).length);
  if(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name='_'+name;
  return name+extension;
}

export function parsePlaylist(text,base) {
  if(!text.trimStart().startsWith('#EXTM3U')) throw fail('El servidor no devolvió una lista HLS válida.');
  if(/#EXT-X-(?:KEY|SESSION-KEY):[^\n]*METHOD=(?!NONE(?:,|\s|$))/i.test(text)) throw fail('Esta fuente está cifrada. Elige otro servidor con descarga directa.');
  if(/#EXT-X-MEDIA:[^\n]*TYPE=AUDIO[^\n]*URI=/i.test(text)) throw fail('Este HLS usa audio separado. Elige una fuente MP4 para guardar audio y video juntos.');
  const lines=text.split(/\r?\n/).map(x=>x.trim()); const variants=[];
  for(let i=0;i<lines.length;i++) {
    if(!lines[i].startsWith('#EXT-X-STREAM-INF:')) continue;
    const line=lines.slice(i+1).find(x=>x&&!x.startsWith('#'));
    if(line) variants.push({url:new URL(line,base).href,bandwidth:Number(lines[i].match(/(?:^|[:,])BANDWIDTH=(\d+)/)?.[1]||0)});
  }
  if(variants.length) return {variants:variants.sort((a,b)=>b.bandwidth-a.bandwidth)};
  if(!/#EXT-X-ENDLIST(?:\s|$)/m.test(text)) throw fail('La fuente está en directo o aún no ha terminado. Usa un video completo para descargar.');
  if(/#EXT-X-(?:BYTERANGE|DISCONTINUITY)(?::|\s|$)/m.test(text)) throw fail('Este HLS necesita conversión adicional. Elige otro servidor o una fuente MP4.');
  const maps=[...text.matchAll(/#EXT-X-MAP:([^\n]+)/g)];
  if(maps.length>1||maps.some(m=>/BYTERANGE=/.test(m[1]))) throw fail('Esta lista HLS usa fragmentos que requieren conversión. Elige otra fuente.');
  const map=maps[0]?.[1].match(/URI="([^"]+)"/)?.[1];
  const segments=lines.filter(x=>x&&!x.startsWith('#'));
  if(!segments.length||segments.length>20000) throw fail('La lista HLS está vacía o contiene demasiados segmentos.');
  if(!map && segments.some(x=>/\.(m4s|mp4)(?:[?#]|$)/i.test(x))) throw fail('Falta la cabecera de inicialización del video.');
  return {pieces:[...(map?[map]:[]),...segments].map(x=>new URL(x,base).href),extension:map?'.mp4':'.ts',contentType:map?'video/mp4':'video/mp2t'};
}

export function createDownloadService({fetchRemote,discoverMedia=()=>[],extractEmbeddedSources=()=>[]}) {
  const jobs=new Map();
  const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
  const snapshot=job=>({id:job.id,kind:job.kind,filename:job.filename,state:job.state,contentLength:job.total,resumable:job.resumable,bytes:job.bytes,segments:job.segments||0,totalSegments:job.playlist?.pieces.length||0,startedAt:job.startedAt||null,updatedAt:job.updatedAt,error:job.error||null,speed:job.startedAt?Math.round((job.bytes-(job.offset||0))/Math.max(1,(Date.now()-job.startedAt)/1000)):0});
  const touch=(job,state)=>{job.state=state;job.updatedAt=Date.now();};
  function prune() {
    for(const [id,j] of jobs) if(!j.controller && Date.now()-j.updatedAt>24*60*60*1000) jobs.delete(id);
    if(jobs.size>=500) for(const [id,j] of jobs) {if(!j.controller) jobs.delete(id);if(jobs.size<450) break;}
    if(jobs.size>=500) throw fail('Hay demasiadas descargas pendientes. Vuelve a intentarlo más tarde.',429);
  }
  async function playlist(url,referer,signal) {
    for(let depth=0;depth<4;depth++) {
      const {response,finalUrl}=await fetchRemote(url,{headers:mediaHeaders(referer),signal});
      if(!response.ok) {await cancel(response);throw fail(`La fuente HLS respondió ${response.status}.`,502);}
      const parsed=parsePlaylist(await readTextLimited(response,2000000),finalUrl);
      if(!parsed.variants) return {...parsed,url:finalUrl,referer};
      referer=finalUrl;url=parsed.variants[0].url;
    }
    throw fail('La lista HLS tiene demasiados niveles.');
  }
  async function resolve(url,referer,signal,depth=0) {
    const {response,finalUrl}=await fetchRemote(url,{headers:mediaHeaders(referer),signal});
    if(!response.ok) {await cancel(response);throw fail(`La fuente respondió ${response.status}. Prueba otro servidor.`,502);}
    const ct=(response.headers.get('content-type')||'').toLowerCase();
    // Never save an HTML challenge or an error page under a video filename.
    if(/html|application\/json/.test(ct)) {
      if(!ct.includes('html')||depth>=2) {await cancel(response);throw fail('El servidor no ofrece un archivo de video directo.');}
      const html=await readTextLimited(response);
      const sources=[...discoverMedia(html,finalUrl),...extractEmbeddedSources(html,finalUrl,finalUrl)];
      const candidates=sources.filter(s=>['mp4','hls','embed'].includes(s.type)&&s.url!==url).slice(0,6).sort((a,b)=>(a.type==='embed')-(b.type==='embed'));
      for(const source of candidates) {try {return await resolve(source.url,finalUrl,signal,depth+1);} catch(e) {signal?.throwIfAborted();}}
      throw fail('Este reproductor no expone una descarga directa. Prueba otro servidor o abre su página.');
    }
    if(/mpegurl/.test(ct)||/\.m3u8(?:[?#]|$)/i.test(finalUrl)) {
      await cancel(response);
      return {kind:'hls',url:finalUrl,referer,playlist:await playlist(finalUrl,referer,signal)};
    }
    if(/^(video|audio)\//.test(ct)||(/application\/octet-stream/.test(ct)&&MEDIA_EXT.test(new URL(finalUrl).pathname))) {
      return {kind:'file',url:finalUrl,referer,response,contentType:ct};
    }
    await cancel(response);throw fail('El enlace no devuelve un archivo de video o audio compatible.');
  }
  async function prepare(url,signal) {
    prune();
    const input=url.searchParams.get('url')?.trim();if(!input) throw fail('Pega un enlace de video.',400);
    const requested=url.searchParams.get('filename')||'BloqueTV';
    let referer=url.searchParams.get('referer')||'';
    if(referer) {try {const u=new URL(referer);referer=['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u.href:'';}catch{referer='';}}
    const resolved=await resolve(input,referer,signal);
    const response=resolved.response;
    const ct=resolved.playlist?.contentType||resolved.contentType;
    const job={id:randomUUID(),...resolved,response:undefined,filename:downloadName(requested,resolved.url,ct,resolved.playlist?.extension),contentType:ct,total:Number(response?.headers.get('content-length'))||null,resumable:resolved.kind==='file'&&/bytes/i.test(response?.headers.get('accept-ranges')||''),bytes:0,state:'ready',updatedAt:Date.now(),etag:response?.headers.get('etag'),modified:response?.headers.get('last-modified')};
    await cancel(response);jobs.set(job.id,job);return job;
  }
  async function writeBody(response,res,job,signal) {
    if(!response.body) throw fail('La fuente no envió datos.',502);
    const expected=Number(response.headers.get('content-length'))||null; let received=0;
    for await(const chunk of response.body) {
      signal.throwIfAborted();if(res.destroyed) throw fail('El navegador interrumpió la transferencia.',499);
      received+=chunk.length;job.bytes+=chunk.length;job.updatedAt=Date.now();
      if(!res.write(Buffer.from(chunk))) await once(res,'drain',{signal});
    }
    if(expected!==null&&received!==expected) throw fail('La fuente interrumpió el archivo antes de completarlo.',502);
  }
  function attachment(res,job,status=200) {
    res.statusCode=status;
    const ascii=job.filename.replace(/[^\x20-\x7e]|["\\]/g,'_');
    res.setHeader('Content-Type',job.contentType);
    res.setHeader('Content-Disposition',`attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(job.filename).replace(/['()*]/g,c=>`%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`);
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('X-Nexus-Download',job.kind==='hls'?'hls-assembled':'native');
  }
  async function transfer(req,res,job) {
    if(job.controller) throw fail('Esta descarga ya está en curso.',409);
    if(job.state==='cancelled') throw fail('Esta descarga fue cancelada. Pulsa Reintentar para crear otra.',410);
    if([...jobs.values()].filter(j=>j.controller).length>=4) throw fail('Ya hay cuatro transferencias activas. Espera a que termine una.',429);
    const controller=new AbortController();const signal=controller.signal;
    job.controller=controller;job.bytes=0;job.offset=0;job.segments=0;job.error=null;job.startedAt=Date.now();touch(job,'starting');
    const abort=()=>{if(!res.writableFinished) controller.abort();};
    res.once('close',abort);req.once('aborted',abort);
    try {
      const range=String(req.headers.range||'');
      if(range&&!/^bytes=\d*-\d*$/.test(range)) throw fail('El rango solicitado no es válido.',416);
      if(job.kind==='hls') {
        if(range) throw fail('Las descargas HLS deben reiniciarse desde el principio.',416);
        // Revalidate before sending headers so unsupported changes fail visibly.
        job.playlist=await playlist(job.url,job.referer,signal);
        job.contentType=job.playlist.contentType;
        job.filename=downloadName(job.filename,job.url,job.contentType,job.playlist.extension);
        for(const [index,piece] of job.playlist.pieces.entries()) {
          const {response}=await fetchRemote(piece,{headers:mediaHeaders(job.playlist.url),signal});
          if(!response.ok||/html|json/i.test(response.headers.get('content-type')||'')) {await cancel(response);throw fail(`No se pudo descargar el fragmento ${index+1}.`,502);}
          if(!res.headersSent) {attachment(res,job);touch(job,'transferring');res.flushHeaders();}
          await writeBody(response,res,job,signal);job.segments=index+1;
        }
      } else {
        const headers=mediaHeaders(job.referer);
        if(range) {headers.range=range;const validator=req.headers['if-range']||job.etag||job.modified;if(validator)headers['if-range']=validator;}
        const {response}=await fetchRemote(job.url,{headers,signal});
        if(response.status===416) {
          const cr=response.headers.get('content-range');if(cr)res.setHeader('Content-Range',cr);
          await cancel(response);throw fail('El rango solicitado ya no está disponible. Reinicia la descarga.',416);
        }
        const ct=response.headers.get('content-type')||'';
        if(![200,206].includes(response.status)||/html|json|text\//i.test(ct)) {await cancel(response);throw fail('El enlace caducó o el servidor no entregó el video. Reintenta desde la fuente.',502);}
        const length=response.headers.get('content-length');
        const cr=response.headers.get('content-range');
        if(response.status===206) {
          const match=cr?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
          if(!range||!match) {await cancel(response);throw fail('La fuente devolvió un rango inválido.',502);}
          job.offset=Number(match[1]);job.bytes=job.offset;job.total=Number(match[3]);
        } else job.total=Number(length)||null;
        attachment(res,job,response.status);
        if(length&&/^\d+$/.test(length))res.setHeader('Content-Length',length);
        for(const header of ['content-range','accept-ranges','etag','last-modified']) {const value=response.headers.get(header);if(value)res.setHeader(header,value);}
        touch(job,'transferring');res.flushHeaders();await writeBody(response,res,job,signal);
      }
      const finished=once(res,'finish',{signal});res.end();await finished;
      touch(job,job.total&&job.bytes<job.total?'interrupted':'transferred');
    } catch(error) {
      if(job.state!=='cancelled') {job.error=signal.aborted?'El navegador interrumpió la transferencia. Puedes reintentar.':error.message;touch(job,signal.aborted?'interrupted':'error');}
      if(res.headersSent)res.destroy();else if(!res.destroyed)json(res,error.status||502,{error:job.error||'Descarga cancelada.'});
    } finally {res.off('close',abort);req.off('aborted',abort);controller.abort();job.controller=null;}
  }
  return {
    async handle(req,res,url) {
      const path=url.pathname;
      if(!['/api/download-info','/api/native-download','/api/download','/api/download-status','/api/download-cancel'].includes(path)) return false;
      try {
        const expected=path==='/api/download-cancel'?'POST':'GET';
        if(req.method!==expected) {res.setHeader('Allow',expected);throw fail('Método no permitido.',405);}
        if(req.headers.origin && req.headers.origin!==url.origin) throw fail('Solicitud de otro origen no permitida.',403);
        if(path==='/api/download-info') {
          const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),30000);
          const close=()=>{if(!res.writableFinished)controller.abort();};res.once('close',close);
          try {const job=await prepare(url,controller.signal);json(res,200,{ok:true,...snapshot(job),downloadUrl:`/api/native-download?id=${job.id}`});}
          finally {clearTimeout(timer);res.off('close',close);controller.abort();}
        } else {
          const id=url.searchParams.get('id');let job=jobs.get(id);
          if(!id&&['/api/native-download','/api/download'].includes(path))job=await prepare(url,AbortSignal.timeout(30000));
          if(!job) throw fail('La sesión de descarga caducó. Pulsa Reintentar.',404);
          if(path==='/api/download-status') json(res,200,snapshot(job));
          else if(path==='/api/download-cancel') {if(!['transferred','cancelled'].includes(job.state)){touch(job,'cancelled');job.controller?.abort();}json(res,200,snapshot(job));}
          else await transfer(req,res,job);
        }
      } catch(e) {if(!res.headersSent&&!res.destroyed)json(res,e.status||502,{error:e.name==='AbortError'?'La fuente tardó demasiado. Prueba otro servidor.':e.message});else if(!res.writableEnded)res.destroy();}
      return true;
    }
  };
}
