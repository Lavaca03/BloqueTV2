import { displayText, mediaTitle } from '../public/display-text.js';
import { donghuaEpisodeIdentity, donghuaSeasonBelongsToSeries, filterDonghuaDetail } from '../public/episode-identity.js';

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
function excluded(node) {
  for (let n = node; n; n = n.parent) {
    if (['aside','footer','script','template'].includes(n.tag) || (n.tag === 'nav' && !hasClass(n,'pager')) || /(?:^|\s)(?:region-aside|region-sidebar[^\s]*|sidebar|related|recommendations|comments)(?:\s|$)/i.test(n.attrs.class || '')) return true;
    // These blocks can also appear inside <main> or a malformed article.
    if (/(?:^|[\s_-])(?:mas[-_]vistos|most[-_]viewed|recomendados|related|recommendations)(?:[\s_-]|$)/i.test(`${n.attrs.class || ''} ${n.attrs.id || ''}`)) return true;
  }
  return false;
}
const pathKey = value => new URL(value).pathname.replace(/\/$/,'');
const hostKey = value => new URL(value).host.toLowerCase().replace(/^www\./,'');
function linkTo(raw, pageUrl, kind) {
  try {
    const u = new URL(raw, pageUrl);
    if (!/^https?:$/.test(u.protocol) || u.username || u.password || hostKey(u) !== hostKey(pageUrl)) return null;
    if (kind && !new RegExp(`^/${kind}/[^/]+/?$`).test(u.pathname)) return null;
    return u;
  } catch { return null; }
}
const cleanUrl = url => { const u = new URL(url); u.search = ''; u.hash = ''; u.pathname = u.pathname.replace(/\/$/,''); return u.href; };
const slugOf = url => decodeURIComponent(pathKey(url).split('/').at(-1)).toLowerCase();
const numberOfSeason = (url, label = '', fallback = 1) => Number(String(label).match(/(?:temporada|temp|season)\s*(\d+)/i)?.[1] || pathKey(url).match(/-(\d+)$/)?.[1]) || fallback;
export const donghuaItemId = (url, kind) => `dlife-${kind}-${Buffer.from(cleanUrl(url)).toString('base64url')}`;

export function parseDonghuaPage(html, pageUrl) {
  html = String(html || '');
  const nodes = documentNodes(html);
  const root = nodes.find(n => n.tag === 'article' && hasClass(n,'node--view-mode-full'))
    || nodes.find(n => hasClass(n,'block-system-main-block')) || nodes.find(n => n.tag === 'main');
  const text = node => node ? plain(html.slice(node.innerStart,node.innerEnd)) : '';
  const main = nodes.filter(n => root && within(n,root) && !excluded(n));
  const meta = key => nodes.find(n => n.tag === 'meta' && (n.attrs.property || n.attrs.name || '').toLowerCase() === key)?.attrs.content || '';
  const ownHeading = main.find(n => n.tag === 'a' && n.attrs.href && linkTo(n.attrs.href,pageUrl) && pathKey(new URL(n.attrs.href,pageUrl)) === pathKey(pageUrl) && (n.attrs.rel?.split(/\s+/).includes('bookmark') || /^h[1-3]$/.test(n.parent?.tag)));
  const title = mediaTitle(text(ownHeading),meta('og:title'),text(nodes.find(n => n.tag === 'title')), ...main.filter(n => n.tag === 'h1').map(text),slugOf(pageUrl).replace(/-/g,' '));
  const synopsis = text(main.find(n => hasClass(n,'synopsis')));
  const description = meta('description') || meta('og:description');
  const overview = displayText(synopsis || (/donghua[\s-]*life|wide range of Chinese anime/i.test(description) ? '' : description));
  const poster = main.find(n => n.tag === 'img' && hasClass(n,'image-style-poster'));
  let posterUrl = null;
  try { const u = new URL(poster?.attrs.src || meta('og:image'),pageUrl); if (/^https?:$/.test(u.protocol) && (poster?.attrs.src || meta('og:image'))) posterUrl = u.href; } catch {}
  const bodyText = text(root);
  const status = bodyText.match(/Estado\s*:?\s*([^|•]{2,45}?)(?=\s+(?:Fecha|G[eé]nero|Duraci[oó]n|Sinopsis|Temporadas|$))/i)?.[1]?.trim() || '';
  const duration = bodyText.match(/Duraci[oó]n\s*:?\s*(\d+\s*(?:min|mins|minutos?))/i)?.[1] || '';
  const dateText = main.find(n => n.tag === 'time' && n.attrs.datetime)?.attrs.datetime.match(/\d{4}/)?.[0] || '';
  const anchors = main.filter(n => n.tag === 'a' && n.attrs.href);
  const genres = [...new Set(anchors.filter(n => linkTo(n.attrs.href,pageUrl,'donghuas')).map(text).filter(Boolean))].slice(0,12);
  const seasonScopes = main.filter(n => ['view-id-temporadas','view-temporadas','temporada','temporadas'].some(c => hasClass(n,c)));
  const episodeScopes = main.filter(n => ['view-id-episodios','view-episodios','episodios','episode-list'].some(c => hasClass(n,c)));
  const isInside = (node, scopes) => scopes.some(scope => within(node,scope));
  const seasons = new Map(), episodes = new Map();
  for (const node of anchors) {
    const u = linkTo(node.attrs.href,pageUrl,'season');
    if (!u || !isInside(node,seasonScopes)) continue;
    let card = node.parent;
    while (card && card !== root && !hasClass(card,'serie') && !hasClass(card,'views-row')) card = card.parent;
    const siblings = card && card !== root ? main.filter(n=>within(n,card)) : [];
    const url = cleanUrl(u), label = text(siblings.find(n=>hasClass(n,'titulo'))) || text(node);
    const number = numberOfSeason(url,label,0);
    const special = siblings.some(n=>hasClass(n,'especial')) || !number;
    const ref = {url,title:label,season_number:special?null:number,special,seriesUrl:cleanUrl(pageUrl)};
    if (donghuaSeasonBelongsToSeries(ref,pageUrl) && !seasons.has(url)) seasons.set(url,ref);
  }
  for (const node of anchors) {
    const u = linkTo(node.attrs.href,pageUrl,'episode');
    if (!u || !isInside(node,episodeScopes)) continue;
    const identity = donghuaEpisodeIdentity(u.href,pageUrl);
    if (!identity) continue;
    const key = `${identity.season_number}:${identity.episode_number}`;
    if (!episodes.has(key)) episodes.set(key,{...identity,name:`Capítulo ${identity.episode_number}`,thumbnail:null});
  }
  let maxPage = 0;
  for (const node of anchors) {
    if (!isInside(node,episodeScopes)) continue;
    const u = linkTo(node.attrs.href,pageUrl);
    if (!u || pathKey(u) !== pathKey(pageUrl)) continue;
    const page = Number(u.searchParams.get('page'));
    if (Number.isSafeInteger(page) && page > 0) maxPage = Math.max(maxPage,Math.min(page,20));
  }
  const canonical = nodes.find(n => n.tag === 'link' && n.attrs.rel?.split(/\s+/).includes('canonical'))?.attrs.href;
  if (canonical) {
    const u = linkTo(canonical,pageUrl);
    if (!u || pathKey(u) !== pathKey(pageUrl)) throw Object.assign(new Error('La página recibida no corresponde al título seleccionado.'),{status:502});
  }
  return {url:cleanUrl(pageUrl),title,overview,posterUrl,status,duration,dateText,genres,seasons:[...seasons.values()],episodes:[...episodes.values()].sort((a,b)=>a.season_number-b.season_number || a.episode_number-b.episode_number),maxPage};
}

export function createDonghuaDetailsReader({baseUrl,fetchPage}) {
  async function page(raw, kind) {
    const url = linkTo(raw,baseUrl,kind);
    if (!url) throw Object.assign(new Error('El enlace no corresponde a un título disponible.'),{status:400});
    const result = await fetchPage(url.href);
    const final = linkTo(result.finalUrl,url,kind);
    if (!final || pathKey(final) !== pathKey(url)) throw Object.assign(new Error('La página recibida no corresponde al título seleccionado.'),{status:502});
    return parseDonghuaPage(result.html,final.href);
  }
  async function season(ref) {
    const first = await page(ref.url,'season');
    const episodes = new Map(first.episodes.map(ep=>[ep.episode_number,ep]));
    const urls = Array.from({length:first.maxPage},(_,i)=>{const u = new URL(first.url);u.searchParams.set('page',String(i+1));return u.href;});
    for (let i=0;i<urls.length;i+=4) {
      const batch = await Promise.allSettled(urls.slice(i,i+4).map(url=>page(url,'season')));
      for (const result of batch) if (result.status === 'fulfilled') for (const ep of result.value.episodes) if (!episodes.has(ep.episode_number)) episodes.set(ep.episode_number,ep);
    }
    return {season_number:ref.season_number,special:ref.special,label:ref.special?mediaTitle(ref.title,first.title,'Especial'):`Temporada ${ref.season_number}`,title:first.title,url:first.url,seriesUrl:ref.seriesUrl,episodes:[...episodes.values()].sort((a,b)=>a.episode_number-b.episode_number)};
  }
  async function details(url) {
    const parsed = await page(url,'series');
    const {seasons:refs,episodes:direct,maxPage,...metadata} = parsed;
    const seasons = [];
    for (let i=0;i<refs.length;i+=3) {
      const batch = await Promise.allSettled(refs.slice(i,i+3).map(season));
      seasons.push(...batch.filter(x=>x.status==='fulfilled').map(x=>x.value));
    }
    // A failed season request must not be replaced with recommendation links.
    if (!refs.length) for (const ep of direct) {
      let group = seasons.find(s=>s.season_number===ep.season_number);
      if (!group) {group={season_number:ep.season_number,title:`${metadata.title} · Temporada ${ep.season_number}`,url:metadata.url,episodes:[]};seasons.push(group);}
      group.episodes.push(ep);
    }
    if (!seasons.some(s=>s.special)) seasons.sort((a,b)=>a.season_number-b.season_number);
    return filterDonghuaDetail({...metadata,id:donghuaItemId(metadata.url,'series'),seasons},metadata.url);
  }
  async function movieDetails(url) {
    const {seasons,episodes,maxPage,...metadata} = await page(url,'movie');
    return {...metadata,id:donghuaItemId(metadata.url,'movie')};
  }
  return {details,movieDetails};
}
