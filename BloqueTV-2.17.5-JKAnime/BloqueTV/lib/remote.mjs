import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns/promises';
import net from 'node:net';
import { Readable } from 'node:stream';
import { createGunzip, createInflate, createBrotliDecompress } from 'node:zlib';

export function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a,b,c] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 192 && b === 0) || (a === 198 && [18,19].includes(b)) ||
      (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113);
  }
  // Only globally routed IPv6 unicast. This excludes mapped IPv4, loopback,
  // link-local, multicast and unique-local addresses, including hex aliases.
  if (net.isIPv6(ip)) return !/^[23][0-9a-f]{3}:/i.test(ip) || /^2001:(?:db8|0):/i.test(ip) || /^2002:/i.test(ip);
  return true;
}

async function resolvePublic(raw) {
  let url;
  try { url = new URL(raw); } catch { throw Object.assign(new Error('URL no válida.'), {status:400}); }
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password)
    throw Object.assign(new Error('Usa un enlace HTTP o HTTPS público.'), {status:400});
  const host = url.hostname.replace(/^\[|\]$/g, '');
  let addresses;
  if (net.isIP(host)) addresses=[{address:host,family:net.isIP(host)}];
  else {
    let timer;
    try {addresses=await Promise.race([dns.lookup(host,{all:true}),new Promise((_,reject)=>{
      timer=setTimeout(()=>reject(new Error('La fuente no responde.')),10000);timer.unref();
    })]);} catch {addresses=[];} finally {clearTimeout(timer);}
  }
  if (!addresses.length || addresses.some(x => isPrivateIp(x.address)))
    throw Object.assign(new Error('El enlace debe apuntar a un servidor público válido.'), {status:400});
  return {url, addresses};
}

export async function safeRemoteUrl(raw) { return (await resolvePublic(raw)).url; }

// Pin the DNS result to the connection itself; checking DNS before a separate
// fetch would leave a rebinding window. Redirects receive the same validation.
export async function fetchPublicWithRedirects(raw, {headers={},signal,maxRedirects=6,method='GET',body,redirectOrigin}={}) {
  let next = raw;
  method = method.toUpperCase();
  if (!['GET','HEAD','POST'].includes(method)) throw new Error('Método remoto no permitido.');
  headers = Object.fromEntries(new Headers(headers));
  for (let index=0; index<=maxRedirects; index++) {
    if (redirectOrigin && new URL(next).origin !== redirectOrigin)
      throw Object.assign(new Error('La fuente redirigió a otro sitio.'),{status:502});
    const {url,addresses} = await resolvePublic(next);
    signal?.throwIfAborted();
    const response = await new Promise((resolve,reject) => {
      const transport = url.protocol === 'https:' ? https : http;
      const request = transport.request(url, {
        method, headers: {...headers,'accept-encoding':'identity'}, signal,
        lookup: (_hostname,options,callback) => options.all
          ? callback(null,addresses) : callback(null,addresses[0].address,addresses[0].family)
      }, incoming => {
        const h = new Headers();
        for (const [k,v] of Object.entries(incoming.headers)) if(v !== undefined) {
          if (Array.isArray(v)) for (const entry of v) h.append(k,entry);
          else h.set(k,v);
        }
        const status = incoming.statusCode || 502;
        const redirect = [301,302,303,307,308].includes(status);
        const noBody = redirect || method === 'HEAD' || [204,205,304].includes(status);
        let body=incoming;
        const encoding=h.get('content-encoding');
        const decoder=encoding==='gzip'?createGunzip():encoding==='deflate'?createInflate():encoding==='br'?createBrotliDecompress():null;
        if(!noBody&&decoder){
          incoming.on('error',error=>decoder.destroy(error));
          decoder.on('close',()=>{if(!incoming.complete)incoming.destroy();});
          body=incoming.pipe(decoder);h.delete('content-encoding');h.delete('content-length');
        }
        // Redirect bodies are not consumed. Close before adapting the stream,
        // avoiding a race between buffered data and cancellation of that adapter.
        if (redirect) incoming.destroy();
        else if (noBody) incoming.resume();
        resolve(new Response(noBody?null:Readable.toWeb(body), {status,headers:h}));
      });
      request.setTimeout(30000,()=>request.destroy(new Error('La fuente dejó de enviar datos durante 30 segundos.')));
      request.on('error',reject);
      request.end(body);
    });
    if ([301,302,303,307,308].includes(response.status)) {
      const location=response.headers.get('location');
      await response.body?.cancel().catch(()=>{});
      if(!location) throw Object.assign(new Error('Redirección remota inválida.'),{status:502});
      const target=new URL(location,url);
      if(target.origin!==url.origin) {delete headers.cookie;delete headers.authorization;delete headers['proxy-authorization'];}
      if(response.status===303 || ([301,302].includes(response.status)&&method==='POST')) {
        method='GET';body=undefined;delete headers['content-type'];delete headers['content-length'];
      }
      next=target.href;
      continue;
    }
    return {response,finalUrl:url.href};
  }
  throw Object.assign(new Error('Demasiadas redirecciones.'),{status:508});
}

export async function readTextLimited(response, limit=6000000) {
  if (!response.body) return '';
  const reader=response.body.getReader(); const chunks=[]; let size=0;
  try {
    while(true) {
      const {done,value}=await reader.read(); if(done) break;
      size+=value.byteLength;
      if(size>limit) throw Object.assign(new Error('La página o lista remota es demasiado grande.'),{status:413});
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally { await reader.cancel().catch(()=>{}); reader.releaseLock(); }
}
