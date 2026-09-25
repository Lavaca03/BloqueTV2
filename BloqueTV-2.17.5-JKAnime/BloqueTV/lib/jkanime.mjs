import { fetchPublicWithRedirects, readTextLimited } from './remote.mjs';

const VOID = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
const ENTITIES = { amp:'&', quot:'"', apos:"'", lt:'<', gt:'>', nbsp:' ', ndash:'–', mdash:'—' };
function decode(value = '') {
  return String(value).replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, key) => {
    if (key[0] !== '#') return ENTITIES[key.toLowerCase()] ?? entity;
    const n = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2),16) : Number(key.slice(1));
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : entity;
  });
}
function plain(value) {
  return decode(String(value).replace(/<!--[^]*?-->|<script\b[^]*?<\/script>|<style\b[^]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ')).replace(/\s+/g,' ').trim();
}
function attributes(tag) {
  const attrs = {};
  for (const m of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) attrs[m[1].toLowerCase()] = decode(m[2] ?? m[3] ?? m[4]);
  return attrs;
}

// Retain source boundaries, including the provider's nested divs inside tables.
// Scripts, comments and templates must never contribute catalog links.
function documentNodes(html) {
  const nodes = [], stack = [];
  const tags = /<!--[^]*?-->|<![^>]*>|<\/?([a-z][\w:-]*)\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
  let m;
  while ((m = tags.exec(html))) {
    if (!m[1]) continue;
    const tag = m[1].toLowerCase();
    if (m[0][1] === '/') {
      const index = stack.findLastIndex(n => n.tag === tag);
      if (index >= 0) {
        for (const node of stack.splice(index)) { node.innerEnd = m.index; node.end = tags.lastIndex; }
      }
      continue;
    }
    const node = {tag,attrs:attributes(m[0]),parent:stack.at(-1),start:m.index,innerStart:tags.lastIndex,innerEnd:html.length,end:html.length};
    nodes.push(node);
    if (['script','style','textarea','template'].includes(tag)) {
      const close = new RegExp(`</${tag}\\s*>`,'gi'); close.lastIndex = tags.lastIndex;
      const end = close.exec(html); node.innerEnd = end?.index ?? html.length; node.end = end ? close.lastIndex : html.length; tags.lastIndex = node.end;
    } else if (!VOID.has(tag) && !/\/\s*>$/.test(m[0])) stack.push(node);
    else node.innerEnd = node.end = tags.lastIndex;
  }
  return nodes;
}
const hasClass = (node, name) => String(node?.attrs.class || '').split(/\s+/).includes(name);
function within(node, root) { for (let n = node; n; n = n.parent) if (n === root) return true; return false; }

const fail = (message, status=502) => Object.assign(new Error(message),{status});
const pathKey = value => new URL(value).pathname.replace(/\/$/,'');
const positive = (value, fallback=1) => Number.isSafeInteger(Number(value)) && Number(value)>0 ? Number(value) : fallback;
const reserved = new Set(['directorio','buscar','ajax','ajax_search','jkplayer','horario','genero','tipo','idioma','login','registro']);
export function jkTitleUrl(raw, base='https://jkanime.net') {
  try {
    const u=new URL(raw,base), origin=new URL(base).origin;
    const slug=decodeURIComponent(u.pathname.replace(/\/$/,'').slice(1));
    if(u.origin!==origin || !/^https?:$/.test(u.protocol) || u.username || u.password || !/^\/[^/]+\/?$/.test(u.pathname) || /[\\/\x00-\x20]/.test(slug) || reserved.has(slug.toLowerCase())) return null;
    u.search='';u.hash='';u.pathname=pathKey(u)+'/';return u.href;
  } catch {return null;}
}
export function jkEpisodeUrl(raw, titleUrl, number) {
  try {
    const u=new URL(raw,titleUrl), parent=new URL(titleUrl);
    if(u.origin!==parent.origin || u.username || u.password || !Number.isFinite(Number(number)) || Number(number)<=0) return null;
    if(pathKey(u)!==parent.pathname.replace(/\/$/,'')+'/'+String(Number(number))) return null;
    u.search='';u.hash='';u.pathname=pathKey(u)+'/';return u.href;
  } catch {return null;}
}
const itemId = url => 'jk-'+Buffer.from(url).toString('base64url');
function mediaUrl(raw,base) {
  if(!raw)return null;
  try {const u=new URL(raw,base);return /^https?:$/.test(u.protocol)&&!u.username&&!u.password?u.href:null;}catch{return null;}
}

// Read JSON literals only. Remote JavaScript is never evaluated.
export function scriptJson(html,name) {
  const nodes=documentNodes(html);
  for(const node of nodes.filter(n=>n.tag==='script'&&!n.attrs.src)) {
    const source=html.slice(node.innerStart,node.innerEnd);
    const match=new RegExp(`\\b(?:var|let|const)\\s+${name}\\s*=\\s*([\\[{])`).exec(source);
    if(!match)continue;
    const start=match.index+match[0].length-1;
    let depth=0,quoted=false,escaped=false;
    for(let i=start;i<source.length;i++) {
      const c=source[i];
      if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}
      if(c==='"')quoted=true;
      else if(c==='{'||c==='[')depth++;
      else if(c==='}'||c===']'){if(--depth===0){try{return JSON.parse(source.slice(start,i+1));}catch{throw fail('La fuente cambió el formato de sus datos.');}}}
    }
    throw fail('La fuente devolvió datos incompletos.');
  }
  return null;
}
function view(html) {
  const nodes=documentNodes(html);
  return {nodes,text:n=>n?plain(html.slice(n.innerStart,n.innerEnd)):'',meta:key=>nodes.find(n=>n.tag==='meta'&&(n.attrs.property||n.attrs.name)===key)?.attrs.content||''};
}
function verifyCanonical(v,url) {
  const canonical=v.meta('og:url')||v.nodes.find(n=>n.tag==='link'&&n.attrs.rel==='canonical')?.attrs.href;
  if(!canonical)throw fail('No se pudo confirmar la identidad del título.');
  const u=mediaUrl(canonical,url);
  if(!u||new URL(u).origin!==new URL(url).origin||pathKey(u)!==pathKey(url))throw fail('La página no corresponde al título seleccionado.');
}
function normalizeItem(row,base) {
  const url=jkTitleUrl(row.url,base),title=plain(row.title||'');
  if(!url||!title)return null;
  return {id:itemId(url),type:'jkanime',category:'anime',title,originalTitle:title,overview:plain(row.synopsis||''),posterUrl:mediaUrl(row.image,base),sourceUrl:url,source:'JKAnime',status:plain(row.estado||''),format:plain(row.tipo||''),rating:0,date:''};
}
export function parseJkDirectory(html,base,page=1) {
  const data=scriptJson(html,'animes');
  if(!data||!Array.isArray(data.data)||!Number.isSafeInteger(data.total)||data.total<0)throw fail('No se pudo leer el catálogo de anime. Inténtalo nuevamente.');
  const current=positive(data.current_page),pageCount=positive(data.last_page);
  if(current!==page)throw fail('La fuente no devolvió la página solicitada.');
  const items=[...new Map(data.data.map(row=>normalizeItem(row,base)).filter(Boolean).map(item=>[item.id,item])).values()];
  if(data.data.length&&!items.length)throw fail('No se pudieron reconocer los títulos de esta página.');
  return {items,total:data.total,page:current,pageCount,perPage:positive(data.per_page,30)};
}
export function parseJkSearch(html,base) {
  const v=view(html),scope=v.nodes.find(n=>hasClass(n,'page_directorio'));
  if(!scope)throw fail('No se pudo leer la búsqueda de anime.');
  const cards=v.nodes.filter(n=>hasClass(n,'anime__item')&&within(n,scope));
  const items=cards.map(card=>{
    const nodes=v.nodes.filter(n=>within(n,card));
    const heading=nodes.find(n=>n.tag==='h5'),anchor=nodes.find(n=>n.tag==='a'&&heading&&within(n,heading));
    const picture=nodes.find(n=>n.attrs['data-setbg']);
    return normalizeItem({url:anchor?.attrs.href,title:v.text(heading),image:picture?.attrs['data-setbg'],estado:v.text(nodes.find(n=>n.tag==='li'&&!hasClass(n,'anime'))),tipo:v.text(nodes.find(n=>hasClass(n,'anime')))},base);
  }).filter(Boolean);
  return [...new Map(items.map(item=>[item.id,item])).values()];
}
export function parseJkDetail(html,url) {
  const v=view(html);verifyCanonical(v,url);
  const info=v.nodes.find(n=>hasClass(n,'anime_info'));
  if(!info)throw fail('No se pudo leer la ficha del anime.');
  const root=v.nodes.find(n=>hasClass(n,'anime__details__content'));
  const nodes=v.nodes.filter(n=>within(n,root||info));
  const title=v.text(nodes.find(n=>n.tag==='h3'));
  const lists=nodes.filter(n=>n.tag==='li');
  const field=label=>{const row=lists.find(n=>v.text(n).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().startsWith(label+':'));return row?v.text(row).replace(/^[^:]*:\s*/,''):'';};
  const id=v.nodes.find(n=>n.attrs.id==='guardar-anime'&&/^\d+$/.test(n.attrs['data-anime']||''))?.attrs['data-anime'];
  const apiId=html.match(/\/ajax\/episodes\/(\d+)\//)?.[1];
  if(!title||!id||(apiId&&apiId!==id))throw fail('No se pudo confirmar la lista de episodios del anime.');
  const posterScope=v.nodes.find(n=>hasClass(n,'anime_pic'));
  const poster=v.nodes.find(n=>n.tag==='img'&&posterScope&&within(n,posterScope));
  const dateText=field('emitido').match(/\b(?:19|20)\d{2}\b/)?.[0]||'';
  const genres=nodes.filter(n=>n.tag==='a'&&/^\/genero\//.test(new URL(n.attrs.href||'/',url).pathname)).map(v.text).filter(Boolean);
  const declaredCount=Number(field('episodios'))||0;
  return {metadata:{id:itemId(url),type:'jkanime',category:'anime',url,title,overview:v.text(nodes.find(n=>n.tag==='p'&&hasClass(n,'scroll'))),posterUrl:mediaUrl(poster?.attrs.src,url),episodeCount:declaredCount,status:field('estado'),duration:field('duracion'),format:field('tipo'),language:field('idiomas'),rating:Number(field('puntuacion'))||0,dateText,genres:[...new Set(genres)]},animeId:id,token:v.meta('csrf-token')};
}
export function parseJkEpisodes(data,detail,page=1,query='') {
  const rows=query?data:data?.data;
  if(!Array.isArray(rows))throw fail('La lista de capítulos no está disponible. Inténtalo nuevamente.');
  if(!query&&positive(data.current_page)!==page)throw fail('La fuente no devolvió la página de episodios solicitada.');
  const episodes=[];
  for(const row of rows) {
    const number=Number(row.number);
    if(!Number.isFinite(number)||number<=0||!/^\d+(?:\.\d+)?$/.test(String(row.number)))continue;
    if(query&&number!==Number(query))continue;
    // Links are derived only from rows returned by this title's own API, never from recommendation cards.
    const url=jkEpisodeUrl(detail.url+number+'/',detail.url,number);
    if(!url)continue;
    if(row.anime_id!=null&&String(row.anime_id)!==String(detail.animeId))continue;
    if(row.url&&!jkEpisodeUrl(row.url,detail.url,number))continue;
    episodes.push({id:row.id,episode_number:number,name:`Capítulo ${number}`,url,thumbnail:null});
  }
  const unique=[...new Map(episodes.map(ep=>[ep.episode_number,ep])).values()].sort((a,b)=>a.episode_number-b.episode_number);
  return {episodes:unique,total:query?unique.length:Math.max(0,Number(data.total)||0),page:query?1:positive(data.current_page),pageCount:query?1:positive(data.last_page),perPage:query?16:positive(data.per_page,16),query};
}
export function parseJkSources(html,episodeUrl) {
  const v=view(html);verifyCanonical(v,episodeUrl);
  const labels=new Map(v.nodes.filter(n=>n.attrs['data-id']&&hasClass(n,'servers')).map(n=>[n.attrs['data-id'],v.text(n)]));
  const sources=[];
  const add=(url,label)=>{if(sources.some(s=>s.url===url))return;sources.push({id:`jk-server-${sources.length+1}`,label:plain(label),provider:plain(label),url,type:'embed',quality:'Servidor',fullLength:true,verified:false,pageUrl:episodeUrl});};
  for(const node of v.nodes.filter(n=>n.tag==='script'&&!n.attrs.src)) {
    const script=html.slice(node.innerStart,node.innerEnd);
    for(const m of script.matchAll(/video\[(\d+)\]\s*=\s*'((?:\\.|[^'\\])*)'\s*;/g)) {
      const literal=m[2].replace(/\\(['"/\\])/g,'$1');
      const frame=documentNodes(literal).find(n=>n.tag==='iframe');
      const url=mediaUrl(frame?.attrs.src,episodeUrl);
      if(url&&new URL(url).origin===new URL(episodeUrl).origin&&new URL(url).pathname.startsWith('/jkplayer/')) add(url,labels.get(m[1])||`Servidor ${Number(m[1])+1}`);
    }
  }
  const servers=scriptJson(html,'servers');
  if(Array.isArray(servers))for(const server of servers) {
    if(!server.remote||!server.server||!/^[-\w ]{1,40}$/.test(server.server))continue;
    const decoded=Buffer.from(String(server.remote),'base64').toString('utf8').trim();
    const remote=/^https?:\/\//i.test(decoded)?mediaUrl(decoded,episodeUrl):null;
    if(!remote)continue;
    const url=new URL('/jkplayer/c1',episodeUrl);url.searchParams.set('u',server.remote);url.searchParams.set('s',server.server.toLowerCase());
    add(url.href,server.server);
  }
  return sources;
}

export function createJkAnime({baseUrl='https://jkanime.net',enabled=true,fetchRemote=fetchPublicWithRedirects,ttl=10*60*1000,maxEntries=200,now=Date.now}={}) {
  const base=new URL(baseUrl).origin,cache=new Map(),inflight=new Map();
  const disabled=()=>{if(!enabled)throw fail('El catálogo de anime está desactivado.',503);};
  async function cached(key,task) {
    const hit=cache.get(key);if(hit&&now()-hit.at<ttl)return hit.data;
    if(inflight.has(key))return inflight.get(key);
    const promise=Promise.resolve().then(task).then(data=>{cache.delete(key);cache.set(key,{at:now(),data});while(cache.size>maxEntries)cache.delete(cache.keys().next().value);return data;}).finally(()=>inflight.delete(key));
    inflight.set(key,promise);return promise;
  }
  async function request(url,options={}) {
    const headers={'user-agent':'Mozilla/5.0','accept-language':'es-ES,es;q=0.9',accept:'text/html,application/json',...options.headers};
    const result=await fetchRemote(url,{...options,headers,redirectOrigin:base,signal:AbortSignal.timeout(25000)});
    const {response,finalUrl}=result;
    if(new URL(finalUrl).origin!==base||pathKey(finalUrl)!==pathKey(url)) {await response.body?.cancel();throw fail('La fuente devolvió una página de otro título.');}
    if(!response.ok){await response.body?.cancel();throw fail(`El catálogo no responde (${response.status}).`,response.status===419?419:502);}
    const text=await readTextLimited(response,6000000);
    return {text,headers:response.headers};
  }
  function title(raw) {const url=jkTitleUrl(raw,base);if(!url)throw fail('El enlace no corresponde a un anime disponible.',400);return url;}
  async function session(raw,refresh=false) {
    const url=title(raw),key='detail:'+url;if(refresh)cache.delete(key);
    return cached(key,async()=>{
      const result=await request(url),data=parseJkDetail(result.text,url);
      const cookies=(result.headers.getSetCookie?.()||[]).map(value=>value.split(';')[0]).filter(value=>/^[\w-]+=/.test(value));
      return {...data,cookies:cookies.join('; ')};
    });
  }
  async function ajax(raw,page,query) {
    let detail=await session(raw);
    for(let attempt=0;attempt<2;attempt++) {
      if(!detail.token)throw fail('No se pudo abrir la lista de episodios. Vuelve a intentarlo.');
      const endpoint=query?`/ajax/search_episode/${detail.animeId}/${query}`:`/ajax/episodes/${detail.animeId}/${page}`;
      try {
        const result=await request(base+endpoint,{method:'POST',headers:{accept:'application/json','content-type':'application/x-www-form-urlencoded','x-requested-with':'XMLHttpRequest',referer:detail.metadata.url,...(detail.cookies?{cookie:detail.cookies}:{})},body:new URLSearchParams({_token:detail.token}).toString()});
        let data;try{data=JSON.parse(result.text);}catch{throw fail('La fuente no devolvió una lista de capítulos válida.');}
        return parseJkEpisodes(data,{...detail.metadata,animeId:detail.animeId},page,query);
      }catch(error){if(error.status!==419||attempt)throw error;detail=await session(raw,true);}
    }
  }
  async function catalog(page=1,sort='') {
    disabled();page=positive(page);sort=sort==='popularidad'?'popularidad':'';
    return cached(`catalog:${sort}:${page}`,async()=>{
      const url=new URL('/directorio',base);url.searchParams.set('p',page);if(sort)url.searchParams.set('filtro',sort);
      return parseJkDirectory((await request(url.href)).text,base,page);
    });
  }
  async function search(query,page=1) {
    disabled();const q=String(query||'').trim().slice(0,160);if(q.length<2)throw fail('Escribe al menos 2 caracteres.',400);page=positive(page);
    // Preserve the matches returned by the provider; the complete directory has its own pagination.
    const items=await cached('search:'+q.toLowerCase(),async()=>{const url=new URL('/buscar/'+encodeURIComponent(q),base);return parseJkSearch((await request(url.href)).text,base);});
    const perPage=30,pageCount=Math.max(1,Math.ceil(items.length/perPage));page=Math.min(page,pageCount);
    return {query:q,items:items.slice((page-1)*perPage,page*perPage),total:items.length,page,pageCount,perPage};
  }
  async function episodes(raw,page=1,query='') {
    disabled();const url=title(raw);page=positive(page);query=String(query||'').trim();
    if(query&&!/^\d{1,6}(?:\.\d{1,2})?$/.test(query))throw fail('Escribe el número del capítulo.',400);
    return cached(`episodes:${url}:${page}:${query}`,()=>ajax(url,page,query));
  }
  async function details(raw) {
    disabled();const data=await session(raw);
    let episodePage;
    try {episodePage=await episodes(raw);}catch(error){episodePage={episodes:[],total:data.metadata.episodeCount,page:1,pageCount:1,perPage:16,error:error.message};}
    return {...data.metadata,episodeCount:episodePage.error?data.metadata.episodeCount:episodePage.total,episodes:episodePage.episodes,episodePage};
  }
  async function sources({episodePageUrl,episodeUrl,episode}) {
    const owner=title(episodePageUrl),url=jkEpisodeUrl(episodeUrl,owner,episode);
    if(!url)throw fail('El capítulo no corresponde al anime seleccionado. Vuelve a abrir la ficha.',400);
    if(!enabled)return [];
    const available=await episodes(owner,1,String(episode));
    if(!available.episodes.some(ep=>ep.url===url))throw fail('Este capítulo no está disponible para el anime seleccionado.',404);
    // Signed player URLs are obtained fresh, after checking ownership in the title's API.
    return parseJkSources((await request(url)).text,url);
  }
  return {catalog,search,details,episodes,sources};
}
