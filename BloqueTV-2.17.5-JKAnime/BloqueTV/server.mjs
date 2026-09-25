import http from 'node:http';
import { stat } from 'node:fs/promises';
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { safeRemoteUrl, fetchPublicWithRedirects, readTextLimited } from './lib/remote.mjs';
import { createJkAnime } from './lib/jkanime.mjs';
import { createDownloadService } from './lib/downloads.mjs';
import { displayText, mediaTitle } from './public/display-text.js';
import { createDonghuaDetailsReader, donghuaItemId } from './lib/donghua-pages.mjs';
import { filterDonghuaEpisodes, sameCatalogPage } from './public/episode-identity.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const publicDir = join(__dirname, 'public');
const dataDir = join(__dirname, 'data');

function loadDotEnv() {
  const p = join(__dirname, '.env');
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const i = s.indexOf('=');
    if (i < 1) continue;
    const key = s.slice(0, i).trim();
    let value = s.slice(i + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadDotEnv();

const PORT = Number(process.env.PORT || 4173);
const TMDB_TOKEN = ''; // BloqueTV 2.17 Plus test: TMDb intentionally disconnected
const TMDB_BASE = 'https://api.themoviedb.org/3';
const LANGUAGE = process.env.TMDB_LANGUAGE || 'es-ES';
const STREAM_CATALOG_PATH = process.env.STREAM_CATALOG_PATH || join(dataDir, 'stream-catalog.json');
const SOURCE_API_URL = (process.env.NEXUS_SOURCE_API_URL || '').trim();
const SOURCE_API_TOKEN = (process.env.NEXUS_SOURCE_API_TOKEN || '').trim();
const LATANIME_BASE = (process.env.LATANIME_BASE_URL || 'https://latanime.org').replace(/\/$/, '');
const LATANIME_ENABLED = !/^(0|false|off|no)$/i.test(String(process.env.LATANIME_ENABLED || 'true'));
const MUNDODONGHUA_BASE = (process.env.MUNDODONGHUA_BASE_URL || 'https://www.mundodonghua.com').replace(/\/$/, '');
const MUNDODONGHUA_ENABLED = !/^(0|false|off|no)$/i.test(String(process.env.MUNDODONGHUA_ENABLED || 'true'));
const DONGHUALIFE_BASE = (process.env.DONGHUALIFE_BASE_URL || 'https://donghualife.com').replace(/\/$/, '');
const DONGHUALIFE_ENABLED = !/^(0|false|off|no)$/i.test(String(process.env.DONGHUALIFE_ENABLED || 'true'));
const JKANIME_ENABLED = !/^(0|false|off|no)$/i.test(String(process.env.JKANIME_ENABLED || 'true'));
const jkanime = createJkAnime({enabled:JKANIME_ENABLED});
const hubCache = new Map();
const donghuaLifeCache = new Map();


function loadStreamCatalog() {
  try {
    if (!existsSync(STREAM_CATALOG_PATH)) return { version: 1, updatedAt: null, items: {} };
    const v = JSON.parse(readFileSync(STREAM_CATALOG_PATH, 'utf8'));
    return { version: v.version || 1, updatedAt: v.updatedAt || null, items: v.items || {} };
  } catch (e) {
    console.warn('[CATALOG]', e.message);
    return { version: 1, updatedAt: null, items: {} };
  }
}
let streamCatalog = loadStreamCatalog();

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json; charset=utf-8', '.vtt': 'text/vtt; charset=utf-8', '.mp4': 'video/mp4'
};

function json(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(payload));
}

function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'", "img-src 'self' https: data:",
    "style-src 'self' 'unsafe-inline'", "script-src 'self' https://cdn.jsdelivr.net", "connect-src 'self' https:",
    "media-src 'self' https: blob:", "frame-src 'self' https:",
    "worker-src 'self' blob:", "font-src 'self' data:", "object-src 'none'", "base-uri 'self'"
  ].join('; '));
}

async function tmdb(path, params = {}) {
  if (!TMDB_TOKEN) throw Object.assign(new Error('TMDb no está configurado.'), { status: 503, code: 'TMDB_NOT_CONFIGURED' });
  const u = new URL(TMDB_BASE + path);
  for (const [k, v] of Object.entries({ language: LANGUAGE, ...params })) if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v));
  const r = await fetch(u, { headers: { Authorization: `Bearer ${TMDB_TOKEN}`, accept: 'application/json' } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(d.status_message || `TMDb ${r.status}`), { status: r.status });
  return d;
}

function normalizeItem(item) {
  const type = item.media_type || (item.title ? 'movie' : 'tv');
  return {
    id: item.id, type, title: item.title || item.name || item.original_title || item.original_name || 'Sin título',
    originalTitle: item.original_title || item.original_name || '', overview: item.overview || '',
    posterPath: item.poster_path || null, backdropPath: item.backdrop_path || null,
    rating: Number(item.vote_average || 0), date: item.release_date || item.first_air_date || '',
    popularity: Number(item.popularity || 0), originalLanguage: item.original_language || ''
  };
}

function sourceTypeFromUrl(value = '') {
  const s = String(value).split(/[?#]/)[0].toLowerCase();
  if (s.endsWith('.m3u8')) return 'hls';
  if (/\.(mp4|m4v|webm|mov)$/.test(s)) return 'mp4';
  return null;
}

function cleanSources(sources, provider = null) {
  if (!Array.isArray(sources)) return [];
  const seen = new Set();
  const out = [];
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i] || {};
    const type = s.type === 'video' ? 'mp4' : (s.type || sourceTypeFromUrl(s.url));
    if (!['mp4', 'hls', 'youtube', 'embed'].includes(type)) continue;
    if (typeof s.url !== 'string' || !s.url.trim()) continue;
    if (type !== 'youtube') {try {const u=new URL(s.url);if(!['https:','http:'].includes(u.protocol)||u.username||u.password)continue;}catch{continue;}}
    if (seen.has(s.url)) continue;
    seen.add(s.url);
    out.push({
      id: String(s.id || `source-${i + 1}`), label: String(s.label || `Opción ${out.length + 1}`), type, url: s.url,
      quality: s.quality || 'Auto', language: s.language || null, subtitles: Array.isArray(s.subtitles) ? s.subtitles : [],
      provider: s.provider || provider, verified: s.verified === true, fullLength: s.fullLength !== false,
      pageUrl: s.pageUrl || null, license: s.license || null, origin: s.origin || null
    });
  }
  return out;
}

function catalogSources(type, id, season = null, episode = null) {
  let node = streamCatalog.items?.[`${type}:${id}`];
  if (!node) return [];
  if (type === 'tv' && Number.isFinite(season)) node = node.seasons?.[String(season)];
  if (type === 'tv' && Number.isFinite(episode)) node = node?.episodes?.[String(episode)];
  return cleanSources(node?.sources || [], 'Catálogo BloqueTV');
}

function escapeArchiveTerm(s = '') { return String(s).replace(/["\\]/g, ' ').replace(/[:()\[\]{}]/g, ' ').replace(/\s+/g, ' ').trim(); }
function asString(v) { return Array.isArray(v) ? String(v[0] || '') : String(v || ''); }
function archiveDownloadUrl(identifier, name) { return `https://archive.org/download/${encodeURIComponent(identifier)}/${name.split('/').map(encodeURIComponent).join('/')}`; }

async function archiveSearch({ title, year, type, season, episode, episodeName }) {
  const cleanTitle = escapeArchiveTerm(title);
  if (!cleanTitle) return [];
  const episodeBits = type === 'tv' && Number.isFinite(season) && Number.isFinite(episode)
    ? ` AND (title:("S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}") OR title:("${escapeArchiveTerm(episodeName || '')}"))`
    : '';
  const collections = type === 'tv' ? '(collection:classic_tv OR collection:television)' : '(collection:feature_films OR collection:Film_Noir)';
  const q = `${collections} AND title:("${cleanTitle}")${episodeBits}`;
  const u = new URL('https://archive.org/advancedsearch.php');
  u.searchParams.set('q', q);
  for (const f of ['identifier', 'title', 'year', 'description', 'creator']) u.searchParams.append('fl[]', f);
  u.searchParams.set('rows', '8'); u.searchParams.set('page', '1'); u.searchParams.set('output', 'json');
  const r = await fetch(u, { headers: { accept: 'application/json', 'user-agent': 'BloqueTV/2.0' } });
  if (!r.ok) return [];
  const data = await r.json().catch(() => ({}));
  const docs = data.response?.docs || [];
  const results = await Promise.allSettled(docs.slice(0, 6).map(async (doc) => {
    const id = String(doc.identifier || '');
    if (!/^[A-Za-z0-9._-]+$/.test(id)) return [];
    const mr = await fetch(`https://archive.org/metadata/${encodeURIComponent(id)}`, { headers: { accept: 'application/json', 'user-agent': 'BloqueTV/2.0' } });
    if (!mr.ok) return [];
    const meta = await mr.json().catch(() => ({}));
    const md = meta.metadata || {};
    const license = asString(md.licenseurl || md.license || '');
    const access = asString(md.access || '');
    if (/restricted|private/i.test(access)) return [];
    const files = (meta.files || []).filter((f) => {
      const n = String(f.name || '').toLowerCase();
      const fmt = String(f.format || '').toLowerCase();
      return n.endsWith('.mp4') && !n.includes('_thumb') && !n.includes('sample') && (fmt.includes('mpeg4') || fmt.includes('h.264') || fmt === '' || n.endsWith('.mp4'));
    });
    files.sort((a, b) => Number(b.size || 0) - Number(a.size || 0));
    return files.slice(0, 2).map((f, idx) => ({
      id: `ia-${id}-${idx}`, label: asString(md.title || doc.title || title), type: 'mp4',
      url: archiveDownloadUrl(id, String(f.name)), quality: /512kb/i.test(f.name) ? 'SD' : 'Auto',
      provider: 'Internet Archive', verified: true, fullLength: true,
      pageUrl: `https://archive.org/details/${encodeURIComponent(id)}`, license: license || null,
      archiveIdentifier: id, archiveYear: asString(md.year || doc.year || '')
    }));
  }));
  const sources = results.flatMap((x) => x.status === 'fulfilled' ? x.value : []);
  if (year) {
    const target = Number(year);
    sources.sort((a, b) => Math.abs(Number(a.archiveYear || target) - target) - Math.abs(Number(b.archiveYear || target) - target));
  }
  return cleanSources(sources, 'Internet Archive').slice(0, 8);
}

async function externalSourceApi(params) {
  if (!SOURCE_API_URL) return [];
  try {
    const u = new URL(SOURCE_API_URL);
    for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== '') u.searchParams.set(k, String(v));
    const headers = { accept: 'application/json' };
    if (SOURCE_API_TOKEN) headers.authorization = `Bearer ${SOURCE_API_TOKEN}`;
    const r = await fetch(u, { headers });
    if (!r.ok) return [];
    const d = await r.json().catch(() => ({}));
    return cleanSources(Array.isArray(d) ? d : d.sources, 'Fuente conectada');
  } catch { return []; }
}

function htmlDecode(value = '') {
  return String(value)
    .replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/\\u0026/gi, '&').replace(/\\u003d/gi, '=').replace(/\\u002f/gi, '/')
    .replace(/\\\//g, '/');
}

function stripTags(value = '') {
  return htmlDecode(String(value)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ').trim();
}

function normalizeSearchText(value = '') {
  return stripTags(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function titleScore(query, candidate) {
  const q = normalizeSearchText(query); const c = normalizeSearchText(candidate);
  if (!q || !c) return 0;
  if (q === c) return 1000;
  if (c.includes(q)) return 700 - Math.max(0, c.length - q.length);
  if (q.includes(c)) return 500 - Math.max(0, q.length - c.length);
  const qs = new Set(q.split(' ').filter(x => x.length > 1));
  const cs = new Set(c.split(' ').filter(x => x.length > 1));
  const overlap = [...qs].filter(x => cs.has(x)).length;
  return overlap ? (overlap / Math.max(qs.size, 1)) * 400 : 0;
}

async function fetchHtmlPublic(rawUrl) {
  const safe = await safeRemoteUrl(rawUrl);
  const {response:r, finalUrl} = await fetchPublicWithRedirects(safe.href, {
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153 Safari/537.36 BloqueTV/2.1',
      accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
      'accept-language': 'es-ES,es;q=0.9,en;q=0.6'
    },
    signal: AbortSignal.timeout(16000)
  });
  if (!r.ok) {await r.body?.cancel();throw new Error(`La fuente respondió ${r.status}.`);}
  const ct = (r.headers.get('content-type') || '').toLowerCase();
  if (!ct.includes('html') && !ct.includes('text')) {await r.body?.cancel(); return { html: '', finalUrl };}
  return { html: await readTextLimited(r), finalUrl };
}

function extractAnchors(html, baseUrl) {
  const out = [];
  for (const m of String(html).matchAll(/<a\b([^>]*?)href=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = absolutize(baseUrl, htmlDecode(m[2]));
    if (!href) continue;
    const label = stripTags(m[4]);
    out.push({ href, label, raw: m[0] });
  }
  return out;
}

function inferProvider(url) {
  try {
    const h = new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
    const known = [
      ['tamamo', 'Tamamo'], ['asura', 'Asura'], ['filemoon', 'Filemoon'], ['mp4upload', 'Mp4Upload'], ['mixdrop', 'MixDrop'], ['mxdrop', 'MxDrop'],
      ['voe', 'VOE'], ['lulustream', 'LuluStream'], ['lulu', 'Lulu'], ['doodstream', 'DoodStream'], ['dood', 'DoodStream'],
      ['uqload', 'Uqload'], ['streamwish', 'StreamWish'], ['hlswish', 'HlsWish'], ['listeamed', 'Listeamed'],
      ['vidhide', 'Vidhide'], ['ok.ru', 'OK'], ['dsvplay', 'DSVPlay'], ['hexload', 'Hexload'], ['byse', 'Byse'],
      ['bembed', 'BEmbed'], ['vembed', 'VEmbed'], ['fviplions', 'FViplions'], ['yourupload', 'YourUpload'],
      ['sblona', 'SBLona'], ['swhoi', 'SWHOI'], ['vide0', 'Vide0'], ['savefiles', 'SaveFiles'], ['mega.nz', 'MEGA'],
      ['pixeldrain', 'Pixeldrain'], ['gofile', 'Gofile'], ['mediafire', 'MediaFire'], ['fireload', 'Fireload'],
      ['1cloudfile', 'Cloud'], ['1fichier', '1Fichier'], ['uptobox', 'Uptobox']
    ];
    return known.find(([needle]) => h.includes(needle))?.[1] || h;
  } catch { return 'Web'; }
}

function isAdvertisingUrl(value) {
  try {
    const u = new URL(value);
    const s = `${u.hostname}${u.pathname}`.toLowerCase();
    return /google-analytics|googletagmanager|doubleclick|googlesyndication|adservice|epidemictuna|adsterra|popads|propellerads|exoclick|juicyads|trafficjunky|onclicka|onclick|monetag|hilltopads|popcash|clickadu|ad-maven|admaven|richads|pushground|rollerads|realsrv|tsyndicate|cloudflareinsights/.test(s);
  } catch { return true; }
}

function looksLikeEmbed(url) {
  try {
    const u = new URL(url);
    if (!['http:', 'https:'].includes(u.protocol)) return false;
    const s = u.href.toLowerCase();
    if (/\.(?:css|js|png|jpe?g|gif|webp|svg|ico|woff2?)(?:[?#]|$)/.test(s)) return false;
    if (isAdvertisingUrl(url)) return false;
    if (/facebook|twitter/.test(s)) return false;
    return /embed|player|watch|video|stream|tamamo|asura|filemoon|mp4upload|mixdrop|mxdrop|voe|lulu|dood|uqload|streamwish|hlswish|listeamed|vidhide|ok\.ru|dsvplay|hexload|byse|bembed|vembed|fviplions|yourupload|sblona|swhoi|savefiles|mega\.nz|vide0/i.test(s);
  } catch { return false; }
}

function decodeJsEscapes(value = '') {
  return htmlDecode(String(value || ''))
    .replace(/\\u002[fF]/g, '/')
    .replace(/\\u003[aA]/g, ':')
    .replace(/\\u0026/g, '&')
    .replace(/\\\//g, '/')
    .replace(/\\x2[fF]/g, '/')
    .replace(/\\x3[aA]/g, ':');
}


function decodePackedJsString(value = '') {
  const input = String(value || '');
  let out = '';
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch !== '\\' || i + 1 >= input.length) { out += ch; continue; }
    const n = input[++i];
    if (n === '\\' || n === "'" || n === '"') { out += n; continue; }
    if (n === '/') { out += '/'; continue; }
    if (n === 'n') { out += '\n'; continue; }
    if (n === 'r') { out += '\r'; continue; }
    if (n === 't') { out += '\t'; continue; }
    if (n === 'b') { out += '\b'; continue; }
    if (n === 'f') { out += '\f'; continue; }
    if (n === 'v') { out += '\v'; continue; }
    if (n === 'x' && /^[0-9a-fA-F]{2}$/.test(input.slice(i + 1, i + 3))) {
      out += String.fromCharCode(parseInt(input.slice(i + 1, i + 3), 16)); i += 2; continue;
    }
    if (n === 'u' && /^[0-9a-fA-F]{4}$/.test(input.slice(i + 1, i + 5))) {
      out += String.fromCharCode(parseInt(input.slice(i + 1, i + 5), 16)); i += 4; continue;
    }
    out += n;
  }
  return out;
}

function packerKey(value, radix) {
  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const base = Number(radix);
  let n = Number(value);
  if (!Number.isFinite(n) || n < 0 || !Number.isFinite(base) || base < 2 || base > 62) return '';
  if (n < base) return alphabet[n] || String(n);
  let out = '';
  do { out = alphabet[n % base] + out; n = Math.floor(n / base); } while (n > 0);
  return out;
}

function unpackDeanEdwardsScripts(html = '') {
  const out = [];
  const rx = /eval\(function\(p,a,c,k,e,d\)\{[\s\S]*?\}\('((?:\\.|[^'])*)',(\d+),(\d+),'((?:\\.|[^'])*)'\.split\('\|'\),0,\{\}\)\)/g;
  for (const m of String(html || '').matchAll(rx)) {
    try {
      let payload = decodePackedJsString(m[1]);
      const radix = Number(m[2]);
      const count = Number(m[3]);
      const dict = decodePackedJsString(m[4]).split('|');
      for (let i = count - 1; i >= 0; i--) {
        if (!dict[i]) continue;
        const key = packerKey(i, radix);
        if (!key) continue;
        payload = payload.replace(new RegExp(`\\b${key}\\b`, 'g'), dict[i]);
      }
      if (payload.trim()) out.push(payload);
    } catch {}
  }
  return out;
}

function mundoServerLabels(html = '') {
  const map = new Map();
  for (const m of String(html || '').matchAll(/<button\b([^>]*?\bdata-target=["']([^"']+)["'][^>]*)>([\s\S]*?)<\/button>/gi)) {
    const target = htmlDecode(m[2]).trim().toLowerCase();
    let label = stripTags(m[3]).replace(/\bADS\b/gi, '').replace(/\s+/g, ' ').trim();
    if (!label) label = target;
    map.set(target, label);
  }
  return map;
}

function mundoPackedPlayerSources(html = '', pageUrl = '') {
  const decoded = unpackDeanEdwardsScripts(html);
  const labels = mundoServerLabels(html);
  const out = [];
  const seen = new Set();

  const add = (raw, type = null, target = null) => {
    if (!raw) return;
    let value = decodeJsEscapes(String(raw).trim()).replace(/^['"]|['"]$/g, '');
    if (value.startsWith('//')) value = `https:${value}`;
    const absolute = absolutize(pageUrl, value);
    if (!absolute || seen.has(`${type || ''}|${absolute}`) || isAdvertisingUrl(absolute)) return;
    let parsed;
    try { parsed = new URL(absolute); } catch { return; }
    if (/\/(?:thumbnail|poster|image)\.php(?:[?#]|$)/i.test(parsed.pathname) || /bg_player/i.test(parsed.pathname)) return;
    if (/[?&](?:key|slug)=$/i.test(absolute)) return;
    const inferred = type || sourceTypeFromUrl(absolute) || 'embed';
    if (!['mp4', 'hls', 'embed'].includes(inferred)) return;
    const display = target ? (labels.get(String(target).toLowerCase()) || String(target)) : inferProvider(absolute);
    seen.add(`${inferred}|${absolute}`);
    out.push({
      id: `mundo-packed-${out.length + 1}`,
      label: display,
      type: inferred,
      url: absolute,
      quality: inferred === 'embed' ? 'Servidor' : 'Auto',
      language: null,
      provider: display,
      verified: false,
      fullLength: true,
      pageUrl,
      origin: 'mundodonghua'
    });
  };

  for (const script of decoded) {
    const target = script.match(/#([A-Za-z0-9_-]+)_tab["']/)?.[1]?.toLowerCase()
      || script.match(/#([A-Za-z0-9_-]+)play["']/)?.[1]?.toLowerCase()
      || null;

    for (const m of script.matchAll(/<iframe\b[^>]*\bsrc=['"]([^'"]+)['"][^>]*>/gi)) add(m[1], 'embed', target);
    for (const m of script.matchAll(/\.attr\(\s*["']src["']\s*,\s*["']([^"']+)["']\s*\)/gi)) add(m[1], 'embed', target);
    for (const m of script.matchAll(/sources\s*:\s*\[\s*\{\s*file\s*:\s*["']([^"']+)["']\s*,\s*type\s*:\s*["']hls["']/gi)) add(m[1], 'hls', target || 'asura');
    for (const m of script.matchAll(/["'](https?:\/\/[^"'<>\\\s]+)["']/gi)) {
      const url = m[1];
      const direct = sourceTypeFromUrl(url);
      if (direct) add(url, direct, target);
    }
  }
  return out;
}

async function mundoTamamoSources(html = '', pageUrl = '') {
  const labels = mundoServerLabels(html);
  const decoded = unpackDeanEdwardsScripts(html).join('\n');
  const slug = decoded.match(/url\s*:\s*["']\/api_donghua\.php["'][\s\S]{0,240}?["']slug["']\s*:\s*["']([^"']+)["']/i)?.[1];
  if (!slug) return [];

  let apiUrl;
  try {
    const u = new URL('/api_donghua.php', MUNDODONGHUA_BASE);
    u.searchParams.set('slug', slug);
    apiUrl = (await safeRemoteUrl(u.href)).href;
  } catch { return []; }

  try {
    const r = await fetch(apiUrl, {
      redirect: 'follow',
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153 Safari/537.36 BloqueTV/2.13',
        accept: 'application/json,text/plain,*/*',
        'x-requested-with': 'XMLHttpRequest',
        referer: pageUrl
      },
      signal: AbortSignal.timeout(12000)
    });
    if (!r.ok) return [];
    const raw = (await r.text()).slice(0, 1_000_000);
    let data;
    try { data = JSON.parse(raw); } catch { return []; }
    const rows = Array.isArray(data) ? data : (data && typeof data === 'object' ? Object.values(data) : []);
    const out = [];
    const label = labels.get('tamamo') || 'Tamamo';
    for (const row of rows) {
      const key = row && typeof row === 'object' ? row.url : null;
      if (!key) continue;
      const player = `https://www.mdnemonicplayer.xyz/nemonicplayer/dmplayer.php?key=${String(key)}`;
      out.push({
        id: `mundo-tamamo-${out.length + 1}`, label, type: 'embed', url: player,
        quality: 'Servidor', language: null, provider: label, verified: false, fullLength: true,
        pageUrl, origin: 'mundodonghua'
      });
    }
    return out;
  } catch { return []; }
}

function trimLatanimePlaybackHtml(html = '') {
  const text = String(html || '');
  // Playback servers are rendered before the download section. Cutting here
  // prevents download mirrors/ads from being mistaken for video servers.
  const markers = [
    /<h[1-6][^>]*>[^<]{0,80}Descargar\s+(?:cap[ií]tulo|episodio)/i,
    /Descargar\s+(?:cap[ií]tulo|episodio)\s*\d*/i,
    /id=["'](?:download|descarga|downloads)["']/i
  ];
  let cut = text.length;
  for (const rx of markers) {
    const m = rx.exec(text);
    if (m && m.index > 0) cut = Math.min(cut, m.index);
  }
  return text.slice(0, cut);
}

function extractEmbeddedSources(html, baseUrl, pageUrl = baseUrl) {
  const map = new Map();
  const add = (raw, label = null) => {
    if (!raw) return;
    let cleaned = decodeJsEscapes(String(raw).trim()).replace(/^['"]|['"]$/g, '');
    if (cleaned.startsWith('//')) cleaned = `https:${cleaned}`;
    const url = absolutize(baseUrl, cleaned);
    if (!url || !/^https?:/i.test(url) || map.has(url) || isAdvertisingUrl(url)) return;
    const directType = sourceTypeFromUrl(url);
    if (!directType && !looksLikeEmbed(url)) return;
    const provider = inferProvider(url);
    map.set(url, {
      id: `lat-${map.size + 1}`, label: label && label.length < 80 ? label : provider, type: directType || 'embed', url,
      quality: directType ? 'Auto' : 'Servidor', language: null, provider, verified: false,
      fullLength: true, pageUrl, origin: 'latanime'
    });
  };

  const playbackHtml = trimLatanimePlaybackHtml(html);
  for (const s of discoverMedia(playbackHtml, baseUrl)) add(s.url, s.label);

  // Attributes used by current and older Latanime player templates.
  const attrRx = /(?:src|href|value|data-src|data-url|data-video|data-link|data-embed|data-player|data-server|data-file|data-iframe|data-href|data-player-url|data-video-url|data-embed-url)\s*=\s*["']([^"']+)["']/gi;
  for (const m of playbackHtml.matchAll(attrRx)) add(m[1]);

  // Keep a nearby server label when the URL lives on a button/tab.
  const taggedRx = /<(?:a|button|li|div)\b([^>]*?(?:data-url|data-video|data-link|data-embed|data-player|data-server|data-file|data-iframe|data-href|data-player-url|data-video-url|data-embed-url)\s*=\s*["']([^"']+)["'][^>]*)>([\s\S]*?)<\/(?:a|button|li|div)>/gi;
  for (const m of playbackHtml.matchAll(taggedRx)) {
    const label = stripTags(m[3]).replace(/\s+/g, ' ').trim();
    add(m[2], label || null);
  }

  // Absolute, protocol-relative and JS-escaped URLs in inline scripts/JSON.
  const urlPatterns = [
    /["'](https?:\\?\/\\?\/[^"'<>\s]+)["']/gi,
    /["'](\/\/[^"'<>\s]+)["']/gi,
    /(?:window\.open|location(?:\.href)?|src|file|url)\s*[:=(]\s*["']([^"']+)["']/gi
  ];
  for (const rx of urlPatterns) for (const m of playbackHtml.matchAll(rx)) add(m[1]);

  // Common atob/base64 wrappers used by player templates.
  for (const m of playbackHtml.matchAll(/(?:atob\s*\(\s*)?["']([A-Za-z0-9+/]{32,}={0,2})["']/g)) {
    try {
      const decoded = Buffer.from(m[1], 'base64').toString('utf8');
      if (!/https?:\/\/|\/\/|<iframe|data-(?:url|video|player)/i.test(decoded)) continue;
      for (const u of decoded.matchAll(/https?:\\?\/\\?\/[^"'<>\s]+/gi)) add(u[0]);
      for (const u of decoded.matchAll(/(?:src|data-url|data-video|data-player|data-embed)=["']([^"']+)["']/gi)) add(u[1]);
    } catch {}
  }
  return [...map.values()].slice(0, 60);
}

function extractMetaContent(html, key, attr = 'property') {
  const rx = new RegExp(`<meta\\b[^>]*${attr}=["']${key.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}["'][^>]*content=["']([^"']*)["'][^>]*>`, 'i');
  const reverse = new RegExp(`<meta\\b[^>]*content=["']([^"']*)["'][^>]*${attr}=["']${key.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}["'][^>]*>`, 'i');
  return htmlDecode((String(html).match(rx) || String(html).match(reverse) || [])[1] || '');
}

function extractLatanimeTitle(html, fallback = '') {
  const h = String(html).match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i)?.[1];
  const og = extractMetaContent(html, 'og:title');
  const doc = String(html).match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return stripTags(h || og || doc || fallback).replace(/\s*[—|-]\s*Latanime\s*$/i, '').trim();
}

function imageFromAnchorRaw(raw = '', baseUrl = LATANIME_BASE) {
  const m = String(raw).match(/(?:data-src|src)=["']([^"']+)["']/i);
  return m ? absolutize(baseUrl, htmlDecode(m[1])) : null;
}

async function latanimeSearchPages(title, season = null) {
  if (!LATANIME_ENABLED || !title) return [];
  const queries = [title];
  if (Number.isFinite(season) && season > 1) queries.unshift(`${title} temporada ${season}`, `${title} s${season}`);
  const results = [];
  for (const q of queries.slice(0, 3)) {
    try {
      const u = new URL('/buscar', LATANIME_BASE); u.searchParams.set('q', q);
      const { html, finalUrl } = await fetchHtmlPublic(u.href);
      for (const a of extractAnchors(html, finalUrl)) {
        if (!/\/anime\//i.test(a.href)) continue;
        const slug = a.href.split('/anime/')[1]?.split(/[?#]/)[0] || '';
        const rawTitle = stripTags(String(a.raw).match(/<(?:h1|h2|h3|h4|strong)\b[^>]*>([\s\S]*?)<\/(?:h1|h2|h3|h4|strong)>/i)?.[1] || '');
        const altTitle = htmlDecode(String(a.raw).match(/\balt=["']([^"']+)["']/i)?.[1] || '');
        let inferred = rawTitle || altTitle || a.label || slug.replace(/-/g, ' ');
        if (inferred.length > 140 || /\bver ahora\b/i.test(inferred)) inferred = rawTitle || altTitle || slug.replace(/-/g, ' ');
        results.push({
          url: a.href,
          title: inferred.trim() || slug.replace(/-/g, ' '),
          posterUrl: imageFromAnchorRaw(a.raw, finalUrl),
          score: Math.max(titleScore(q, inferred), titleScore(q, slug.replace(/-/g, ' ')))
        });
      }
    } catch {}
  }
  const byUrl = new Map();
  for (const x of results) if (!byUrl.has(x.url) || byUrl.get(x.url).score < x.score) byUrl.set(x.url, x);
  return [...byUrl.values()].sort((a,b) => b.score - a.score).slice(0, 12);
}

function latanimeVariantPreference(query = '', title = '', url = '') {
  const requested = latanimeLanguageFromTitle(query);
  const language = latanimeLanguageFromTitle(`${title} ${url}`);
  if (requested?.key && language?.key === requested.key) return 100;
  if (requested?.key) return language ? 5 : 1;
  if (language?.key === 'latino') return 30;
  if (language?.key === 'castellano') return 20;
  if (language?.key === 'sub-espanol') return 10;
  return 1;
}

async function latanimeSearchItems(query) {
  const pages = await latanimeSearchPages(query, null);
  const groups = new Map();
  for (const x of pages) {
    const baseTitle = latanimeWorkTitle(x.title) || String(x.title || '').trim();
    const key = normalizeSearchText(baseTitle);
    if (!key) continue;
    const candidate = {
      ...x,
      baseTitle,
      workKey: key,
      preference: latanimeVariantPreference(query, x.title, x.url),
      workScore: Math.max(Number(x.score || 0), titleScore(query, baseTitle))
    };
    const current = groups.get(key);
    if (!current || candidate.preference > current.preference || (candidate.preference === current.preference && candidate.workScore > current.workScore)) groups.set(key, candidate);
  }
  return [...groups.values()]
    .sort((a,b) => b.workScore - a.workScore || b.preference - a.preference)
    .slice(0, 12)
    .map((x) => ({
      id: `latanime-work-${Buffer.from(x.workKey).toString('base64url').slice(0, 32)}`,
      type: 'latanime', title: x.baseTitle, originalTitle: x.baseTitle, overview: '',
      posterPath: null, posterUrl: x.posterUrl || null, backdropPath: null, rating: 0, date: '', popularity: x.workScore || 0,
      originalLanguage: 'es', source: 'BloqueTV Anime', sourceUrl: x.url,
      variantTitle: x.title
    }));
}

const LATANIME_LANGUAGE_VARIANT_CACHE = new Map();
const LATANIME_LANGUAGE_VARIANT_TTL = 5 * 60 * 1000;

function latanimeLanguageFromTitle(value = '') {
  const n = normalizeSearchText(value);
  if (!n) return null;
  if (/\b(?:espanol latino|audio latino|latino)\b/.test(n)) return { key: 'latino', label: 'Español latino', order: 1 };
  if (/\b(?:castellano|espanol de espana|espanol espana)\b/.test(n)) return { key: 'castellano', label: 'Castellano', order: 2 };
  if (/\b(?:sub espanol|subtitulado espanol|subtitulado|sub esp|sub)\b/.test(n)) return { key: 'sub-espanol', label: 'Sub español', order: 3 };
  return null;
}

function latanimeBaseTitle(value = '') {
  return stripTags(value)
    .replace(/\b(?:español\s+latino|audio\s+latino|latino|castellano|español\s+(?:de\s+)?españa|sub(?:titulado)?(?:\s+(?:al\s+)?español)?|sub\s*esp(?:añol)?)\b/gi, ' ')
    .replace(/[\[\]{}()|·•]+/g, ' ')
    .replace(/\s*[-–—:]\s*$/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function latanimeSeasonFromTitle(value = '') {
  const raw = normalizeSearchText(value);
  if (!raw) return 1;
  const patterns = [
    /\b(?:temporada|season)\s*(?:n\s*)?(\d{1,2})\b/i,
    /\b(\d{1,2})(?:st|nd|rd|th)\s+season\b/i,
    /\b(\d{1,2})(?:ra|da|ta)\s+temporada\b/i,
    /\b(?:t|s)\s*[-_.]?\s*(\d{1,2})\b/i
  ];
  for (const rx of patterns) {
    const m = raw.match(rx);
    if (m) { const n = Number(m[1]); if (Number.isFinite(n) && n > 0) return n; }
  }
  return 1;
}

function latanimeWorkTitle(value = '') {
  return latanimeBaseTitle(value)
    .replace(/\b(?:temporada|season)\s*(?:n(?:º|°)?\s*)?\d+\b/gi, ' ')
    .replace(/\b\d+(?:st|nd|rd|th)\s+season\b/gi, ' ')
    .replace(/\b\d+(?:ra|da|ta)\s+temporada\b/gi, ' ')
    .replace(/\b(?:t|s)\s*[-_.]?\s*\d+\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function latanimeSameWork(a = '', b = '') {
  const left = normalizeSearchText(latanimeWorkTitle(a));
  const right = normalizeSearchText(latanimeWorkTitle(b));
  return Boolean(left && right && left === right);
}

const LATANIME_WORK_VARIANT_CACHE = new Map();
const LATANIME_WORK_VARIANT_TTL = 5 * 60 * 1000;

function cloneLatanimeWorkVariants(value) {
  return JSON.parse(JSON.stringify(value));
}

async function latanimeWorkVariants(title, currentUrl = '') {
  const workTitle = latanimeWorkTitle(title) || String(title || '').trim();
  const workKey = normalizeSearchText(workTitle);
  if (!workKey) return { workTitle, seasons: [], activeSeason: 1, activeLanguage: null, activeUrl: currentUrl || '' };

  const cached = LATANIME_WORK_VARIANT_CACHE.get(workKey);
  if (cached && Date.now() - cached.at < LATANIME_WORK_VARIANT_TTL) {
    const data = cloneLatanimeWorkVariants(cached.data);
    const known = data.seasons.some(s => s.languages.some(v => v.url === currentUrl));
    if (!currentUrl || known) {
      if (currentUrl) {
        for (const season of data.seasons) {
          const active = season.languages.find(v => v.url === currentUrl);
          if (active) {
            data.activeSeason = season.season;
            data.activeLanguage = active.key;
            data.activeUrl = currentUrl;
            break;
          }
        }
      }
      return data;
    }
  }

  let currentDetail = null;
  if (currentUrl) currentDetail = await latanimeAnimeDetails(currentUrl).catch(() => null);
  const referenceTitle = currentDetail?.title || title || workTitle;
  const referenceWork = latanimeWorkTitle(referenceTitle) || workTitle;

  const queries = [...new Set([
    referenceWork,
    `${referenceWork} temporada`,
    `${referenceWork} latino`,
    `${referenceWork} castellano`,
    `${referenceWork} sub español`
  ].filter(Boolean))];
  const groups = await Promise.all(queries.map(q => latanimeSearchPages(q, null).catch(() => [])));
  const candidates = groups.flat();
  if (currentDetail?.url && !candidates.some(x => x.url === currentDetail.url)) {
    candidates.unshift({ url: currentDetail.url, title: currentDetail.title || referenceTitle, score: 10000, posterUrl: currentDetail.posterUrl || null, detail: currentDetail });
  } else if (currentUrl && !candidates.some(x => x.url === currentUrl)) {
    candidates.unshift({ url: currentUrl, title: referenceTitle, score: 10000, posterUrl: null, detail: currentDetail });
  }

  const best = new Map();
  for (const candidate of candidates) {
    const candidateTitle = candidate.detail?.title || candidate.title || '';
    if (candidate.url !== currentUrl && !latanimeSameWork(referenceWork, candidateTitle)) continue;
    const season = latanimeSeasonFromTitle(`${candidateTitle} ${candidate.url}`);
    const language = latanimeLanguageFromTitle(`${candidateTitle} ${candidate.url}`) || { key: 'disponible', label: 'Idioma disponible', order: 9 };
    const key = `${season}:${language.key}`;
    const languagePreference = language.key === 'latino' ? 30 : language.key === 'castellano' ? 20 : language.key === 'sub-espanol' ? 10 : 1;
    const score = Number(candidate.score || 0) + languagePreference + (candidate.url === currentUrl ? 10000 : 0);
    const previous = best.get(key);
    if (!previous || score > previous.score) best.set(key, { ...candidate, season, language, score });
  }

  const shortlisted = [...best.values()]
    .sort((a,b) => a.season - b.season || a.language.order - b.language.order)
    .slice(0, 30);
  const verified = [];
  for (let i = 0; i < shortlisted.length; i += 4) {
    const batch = await Promise.all(shortlisted.slice(i, i + 4).map(async candidate => {
      try {
        const detail = candidate.detail || await latanimeAnimeDetails(candidate.url);
        if (!detail?.episodes?.length) return null;
        if (!latanimeSameWork(referenceWork, detail.title || candidate.title) && candidate.url !== currentUrl) return null;
        const season = latanimeSeasonFromTitle(`${detail.title || candidate.title} ${detail.url || candidate.url}`);
        const detected = latanimeLanguageFromTitle(`${detail.title || candidate.title} ${detail.url || candidate.url}`) || candidate.language;
        return {
          season,
          key: detected.key || candidate.language.key,
          label: detected.label || candidate.language.label,
          order: detected.order || candidate.language.order,
          title: detail.title || candidate.title,
          url: detail.url || candidate.url,
          episodeCount: detail.episodes.length,
          posterUrl: detail.posterUrl || candidate.posterUrl || null
        };
      } catch { return null; }
    }));
    verified.push(...batch.filter(Boolean));
  }

  const bySeason = new Map();
  for (const item of verified) {
    if (!bySeason.has(item.season)) bySeason.set(item.season, new Map());
    const languages = bySeason.get(item.season);
    const previous = languages.get(item.key);
    if (!previous || item.url === currentUrl) languages.set(item.key, item);
  }
  const seasons = [...bySeason.entries()].sort((a,b) => a[0] - b[0]).map(([season, languages]) => {
    const list = [...languages.values()].sort((a,b) => a.order - b.order);
    const episodeCount = Math.max(0, ...list.map(v => Number(v.episodeCount || 0)));
    return { season, label: `Temporada ${season}`, episodeCount, languages: list };
  });

  let activeSeason = latanimeSeasonFromTitle(`${currentDetail?.title || referenceTitle} ${currentUrl}`);
  let activeLanguage = latanimeLanguageFromTitle(`${currentDetail?.title || referenceTitle} ${currentUrl}`)?.key || null;
  let activeUrl = currentDetail?.url || currentUrl || '';
  const exactSeason = seasons.find(s => s.languages.some(v => v.url === activeUrl));
  if (exactSeason) {
    const exactLanguage = exactSeason.languages.find(v => v.url === activeUrl);
    activeSeason = exactSeason.season;
    activeLanguage = exactLanguage?.key || activeLanguage;
  } else if (seasons.length) {
    const chosenSeason = seasons.find(s => s.season === activeSeason) || seasons[0];
    const chosenLanguage = chosenSeason.languages.find(v => v.key === activeLanguage)
      || chosenSeason.languages.find(v => v.key === 'latino')
      || chosenSeason.languages[0];
    activeSeason = chosenSeason.season;
    activeLanguage = chosenLanguage?.key || null;
    activeUrl = chosenLanguage?.url || activeUrl;
  }

  const data = { workTitle: latanimeWorkTitle(referenceWork) || referenceWork, seasons, activeSeason, activeLanguage, activeUrl };
  LATANIME_WORK_VARIANT_CACHE.set(workKey, { at: Date.now(), data: cloneLatanimeWorkVariants(data) });
  return data;
}

async function latanimeLanguageVariants(title, currentUrl = '') {
  const data = await latanimeWorkVariants(title, currentUrl);
  const season = data.seasons.find(s => s.season === data.activeSeason) || data.seasons[0];
  return (season?.languages || []).map(v => ({ ...v }));
}

async function latanimeAnimeDetails(animeUrl) {
  const safe = await safeRemoteUrl(animeUrl);
  const baseHost = new URL(LATANIME_BASE).hostname.replace(/^www\./, '');
  if (safe.hostname.replace(/^www\./, '') !== baseHost || !/^\/anime\//i.test(safe.pathname)) {
    throw Object.assign(new Error('La URL no corresponde a una ficha de anime compatible.'), { status: 400 });
  }
  const { html, finalUrl } = await fetchHtmlPublic(safe.href);
  const title = extractLatanimeTitle(html, safe.pathname.split('/').pop()?.replace(/-/g, ' ') || 'Anime');
  const overview = extractMetaContent(html, 'description', 'name') || extractMetaContent(html, 'og:description');
  const posterUrl = extractMetaContent(html, 'og:image') || null;
  const dateText = stripTags(String(html).match(/Estreno:\s*([^<\n]+)/i)?.[1] || '');
  const episodeCount = Number(String(html).match(/Episodios:\s*(\d+)/i)?.[1] || 0) || null;
  const pages = await latanimeEpisodePagesFromHtml(html, finalUrl, null);
  const byNumber = new Map();
  for (const ep of pages) {
    if (!Number.isFinite(ep.episode)) continue;
    if (!byNumber.has(ep.episode)) byNumber.set(ep.episode, {
      episode_number: ep.episode,
      name: ep.label && !/^\s*(?:ver|play)?\s*$/i.test(ep.label) ? ep.label : `Capítulo ${ep.episode}`,
      url: ep.href,
      thumbnail: ep.thumbnail || null
    });
  }
  return {
    url: finalUrl, title, overview, posterUrl, dateText, episodeCount: episodeCount || byNumber.size,
    episodes: [...byNumber.values()].sort((a,b) => a.episode_number - b.episode_number)
  };
}


function mundoEpisodeNumberFromUrl(url) {
  try {
    const u = new URL(url);
    const m = u.pathname.match(/^\/ver\/[^/]+\/(\d+)(?:\/[^/?#]+)?\/?$/i);
    return m ? Number(m[1]) : null;
  } catch { return null; }
}

function extractMundoTitle(html, fallback = '') {
  const og = extractMetaContent(html, 'og:title');
  const doc = String(html).match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const h1 = String(html).match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  return stripTags(og || h1 || doc || fallback).replace(/\s*[-—|]\s*Mundo\s*Donghua\s*$/i, '').trim();
}

function extractMundoOverview(html) {
  const meta = extractMetaContent(html, 'description', 'name') || extractMetaContent(html, 'og:description');
  if (meta && !/animaci[oó]n china|mundo donghua/i.test(meta)) return meta.trim();
  const m = String(html).match(/Sinopsis[\s\S]{0,800}?<p\b[^>]*>([\s\S]*?)<\/p>/i);
  return stripTags(m?.[1] || meta || '').trim();
}

async function mundodonghuaSearchItems(query) {
  if (!MUNDODONGHUA_ENABLED || !query) return [];
  const u = new URL(`/busquedas/${encodeURIComponent(query)}`, MUNDODONGHUA_BASE);
  const { html, finalUrl } = await fetchHtmlPublic(u.href);
  const rows = [];
  for (const a of extractAnchors(html, finalUrl)) {
    if (!/\/donghua\//i.test(a.href)) continue;
    const slug = a.href.split('/donghua/')[1]?.split(/[?#/]/)[0] || '';
    if (!slug) continue;
    const alt = htmlDecode(String(a.raw).match(/\balt=["']([^"']+)["']/i)?.[1] || '');
    let title = stripTags(a.label || alt || slug.replace(/-/g, ' '));
    title = title.replace(/^Donghua\s+/i, '').replace(/\s+/g, ' ').trim();
    if (!title || title.length > 150) title = slug.replace(/-/g, ' ');
    rows.push({
      id: `mundo-${Buffer.from(a.href).toString('base64url').slice(0, 28)}`,
      type: 'donghua', category: 'donghua', title, originalTitle: title, overview: '',
      posterPath: null, posterUrl: imageFromAnchorRaw(a.raw, finalUrl), backdropPath: null,
      rating: 0, date: '', popularity: titleScore(query, title), originalLanguage: 'zh',
      source: 'BloqueTV Donghua', sourceUrl: a.href
    });
  }
  const byUrl = new Map();
  for (const x of rows) if (!byUrl.has(x.sourceUrl)) byUrl.set(x.sourceUrl, x);
  return [...byUrl.values()].sort((a,b) => b.popularity - a.popularity).slice(0, 20);
}



const mundoCatalogCache = new Map();

function parseMundoViews(value = '') {
  const m = String(value).match(/(?:^|\s)(\d{1,3}(?:[.,]\d{3})+|\d{4,})\s*$/);
  return m ? Number(m[1].replace(/[^\d]/g, '')) || 0 : 0;
}

function cleanMundoCatalogTitle(value = '', slug = '') {
  let title = stripTags(value || '').replace(/\s+/g, ' ').trim();
  // On list/search pages the type and visible view count can be part of the anchor text.
  title = title.replace(/\s+(?:\d{1,3}(?:[.,]\d{3})+|\d{4,})\s*$/, '').trim();
  title = title.replace(/^(?:Donghua|Especial|OVA|Pel[ií]cula)\s+/i, '').trim();
  if (!title || title.length > 160) title = String(slug || '').replace(/-/g, ' ').trim();
  return title;
}

function mundoCatalogUrl(page = 1) {
  const n = Math.max(1, Number(page) || 1);
  return new URL(n === 1 ? '/lista-donghuas' : `/lista-donghuas/${n}`, MUNDODONGHUA_BASE).href;
}

async function mundodonghuaCatalogPage(page = 1) {
  if (!MUNDODONGHUA_ENABLED) return { page: 1, pageCount: 1, total: 0, items: [] };
  const n = Math.max(1, Number(page) || 1);
  const cacheKey = `catalog-page:${n}`;
  const cached = mundoCatalogCache.get(cacheKey);
  if (cached && Date.now() - cached.at < 20 * 60 * 1000) return cached.data;

  const { html, finalUrl } = await fetchHtmlPublic(mundoCatalogUrl(n));
  const anchors = extractAnchors(html, finalUrl);
  const rows = [];
  for (const a of anchors) {
    let parsed;
    try { parsed = new URL(a.href); } catch { continue; }
    if (!/^\/donghua\//i.test(parsed.pathname)) continue;
    const slug = parsed.pathname.split('/donghua/')[1]?.split('/')[0] || '';
    if (!slug) continue;
    const heading = stripTags(String(a.raw).match(/<(?:h1|h2|h3|h4|strong|span)\b[^>]*>([\s\S]*?)<\/(?:h1|h2|h3|h4|strong|span)>/i)?.[1] || '');
    const alt = htmlDecode(String(a.raw).match(/\balt=["']([^"']+)["']/i)?.[1] || '');
    const rawName = heading || alt || a.label || slug.replace(/-/g, ' ');
    const views = parseMundoViews(a.label);
    const title = cleanMundoCatalogTitle(rawName, slug);
    rows.push({
      id: `mundo-${Buffer.from(a.href).toString('base64url').slice(0, 28)}`,
      type: 'donghua', category: 'donghua', title, originalTitle: title, overview: '',
      posterPath: null, posterUrl: imageFromAnchorRaw(a.raw, finalUrl), backdropPath: null,
      rating: 0, date: '', popularity: views, views, originalLanguage: 'zh',
      source: 'BloqueTV Donghua', sourceUrl: a.href
    });
  }
  const byUrl = new Map();
  for (const x of rows) if (!byUrl.has(x.sourceUrl)) byUrl.set(x.sourceUrl, x);

  let pageCount = n;
  for (const a of anchors) {
    try {
      const u = new URL(a.href);
      const m = u.pathname.match(/^\/lista-donghuas\/(\d+)\/?$/i);
      if (m) pageCount = Math.max(pageCount, Number(m[1]) || 1);
    } catch {}
  }
  const totalMatch = stripTags(html).match(/([\d.,]+)\s+series\b/i);
  const total = totalMatch ? Number(totalMatch[1].replace(/[^\d]/g, '')) || byUrl.size : byUrl.size;
  const data = { page: n, pageCount, total, items: [...byUrl.values()] };
  mundoCatalogCache.set(cacheKey, { at: Date.now(), data });
  return data;
}

async function mundodonghuaCatalogAll() {
  const cacheKey = 'catalog-all';
  const cached = mundoCatalogCache.get(cacheKey);
  if (cached && Date.now() - cached.at < 30 * 60 * 1000) return cached.data;

  const first = await mundodonghuaCatalogPage(1);
  const pages = [first];
  const rest = Array.from({ length: Math.max(0, first.pageCount - 1) }, (_, i) => i + 2);
  // Small batches avoid hammering the source while still loading the catalog quickly.
  for (let i = 0; i < rest.length; i += 4) {
    const batch = await Promise.all(rest.slice(i, i + 4).map((page) => mundodonghuaCatalogPage(page).catch(() => null)));
    pages.push(...batch.filter(Boolean));
  }
  const byUrl = new Map();
  for (const page of pages) for (const item of page.items || []) if (!byUrl.has(item.sourceUrl)) byUrl.set(item.sourceUrl, item);
  const data = { total: first.total || byUrl.size, pageCount: first.pageCount, items: [...byUrl.values()] };
  mundoCatalogCache.set(cacheKey, { at: Date.now(), data });
  return data;
}

async function mundodonghuaLatestItems() {
  const cacheKey = 'latest';
  const cached = mundoCatalogCache.get(cacheKey);
  if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached.data;
  const { html, finalUrl } = await fetchHtmlPublic(MUNDODONGHUA_BASE + '/');
  const rows = [];
  for (const a of extractAnchors(html, finalUrl)) {
    let u;
    try { u = new URL(a.href); } catch { continue; }
    if (!/^\/donghua\//i.test(u.pathname)) continue;
    const slug = u.pathname.split('/donghua/')[1]?.split('/')[0] || '';
    if (!slug) continue;
    const alt = htmlDecode(String(a.raw).match(/\balt=["']([^"']+)["']/i)?.[1] || '');
    const title = cleanMundoCatalogTitle(alt || a.label || slug.replace(/-/g, ' '), slug);
    rows.push({
      id: `mundo-${Buffer.from(a.href).toString('base64url').slice(0, 28)}`,
      type: 'donghua', category: 'donghua', title, originalTitle: title, overview: '',
      posterPath: null, posterUrl: imageFromAnchorRaw(a.raw, finalUrl), backdropPath: null,
      rating: 0, date: '', popularity: 0, originalLanguage: 'zh', source: 'BloqueTV Donghua', sourceUrl: a.href
    });
  }
  const byUrl = new Map();
  for (const x of rows) if (!byUrl.has(x.sourceUrl)) byUrl.set(x.sourceUrl, x);
  const data = [...byUrl.values()].slice(0, 24);
  mundoCatalogCache.set(cacheKey, { at: Date.now(), data });
  return data;
}

async function mundodonghuaDetails(donghuaUrl) {
  const safe = await safeRemoteUrl(donghuaUrl);
  const baseHost = new URL(MUNDODONGHUA_BASE).hostname.replace(/^www\./, '');
  if (safe.hostname.replace(/^www\./, '') !== baseHost || !/^\/donghua\//i.test(safe.pathname)) {
    throw Object.assign(new Error('La URL no corresponde a una ficha de donghua compatible.'), { status: 400 });
  }
  const { html, finalUrl } = await fetchHtmlPublic(safe.href);
  const fallback = safe.pathname.split('/').pop()?.replace(/-/g, ' ') || 'Donghua';
  const title = extractMundoTitle(html, fallback);
  const overview = extractMundoOverview(html);
  const posterUrl = extractMetaContent(html, 'og:image') || null;
  const episodeCount = Number(String(html).match(/Episodios:\s*(\d+)/i)?.[1] || 0) || null;
  const status = stripTags(String(html).match(/Emisi[oó]n:\s*([^<\n]+)/i)?.[1] || '');
  const byNumber = new Map();
  for (const a of extractAnchors(html, finalUrl)) {
    const ep = mundoEpisodeNumberFromUrl(a.href);
    if (!Number.isFinite(ep)) continue;
    if (!byNumber.has(ep)) byNumber.set(ep, {
      episode_number: ep,
      name: `${title} - ${ep}`,
      url: a.href,
      thumbnail: imageFromAnchorRaw(a.raw, finalUrl)
    });
  }
  return {
    url: finalUrl, title, overview, posterUrl, status,
    episodeCount: episodeCount || byNumber.size,
    episodes: [...byNumber.values()].sort((a,b) => a.episode_number - b.episode_number)
  };
}

async function mundodonghuaSources(params) {
  if (!MUNDODONGHUA_ENABLED || !params.episodeUrl) return [];
  try {
    const safe = await safeRemoteUrl(params.episodeUrl);
    const baseHost = new URL(MUNDODONGHUA_BASE).hostname.replace(/^www\./, '');
    if (safe.hostname.replace(/^www\./, '') !== baseHost || !/^\/ver\//i.test(safe.pathname)) return [];
    const { html, finalUrl } = await fetchHtmlPublic(safe.href);
    const sources = extractEmbeddedSources(html, finalUrl, finalUrl).map((s) => ({ ...s, origin: 'mundodonghua' }));
    const packedSources = mundoPackedPlayerSources(html, finalUrl);
    const tamamoSources = await mundoTamamoSources(html, finalUrl);

    // MundoDonghua has used several player templates. Some expose a public
    // player URL in a hidden input/data attribute, and some keep it base64
    // encoded in the rendered HTML. Decode only values that resolve to an
    // ordinary http(s) player/video URL; authentication/DRM is not bypassed.
    const extra = [];
    const addExtra = (raw, label = null) => {
      if (!raw) return;
      let value = decodeJsEscapes(String(raw).trim()).replace(/^['"]|['"]$/g, '');
      const candidates = [value];
      if (/^[A-Za-z0-9+/]{24,}={0,2}$/.test(value)) {
        try { candidates.push(Buffer.from(value, 'base64').toString('utf8')); } catch {}
      }
      for (let candidate of candidates) {
        const nested = candidate.match(/https?:\?\/\?\/[^"'<>\s]+/i)?.[0] || candidate;
        candidate = decodeJsEscapes(nested);
        if (candidate.startsWith('//')) candidate = `https:${candidate}`;
        const absolute = absolutize(finalUrl, candidate);
        if (!absolute || isAdvertisingUrl(absolute)) continue;
        const directType = sourceTypeFromUrl(absolute);
        if (!directType && !looksLikeEmbed(absolute)) continue;
        const provider = inferProvider(absolute);
        extra.push({
          id: `mundo-extra-${extra.length + 1}`, label: label || provider, type: directType || 'embed', url: absolute,
          quality: directType ? 'Auto' : 'Servidor', provider, verified: false, fullLength: true,
          pageUrl: finalUrl, origin: 'mundodonghua'
        });
      }
    };

    for (const m of String(html).matchAll(/<(?:input|button|a|div|li)\b([^>]*?)>/gi)) {
      const attrs = m[1] || '';
      const label = htmlDecode(attrs.match(/(?:title|aria-label|data-name|data-server-name)=["']([^"']+)["']/i)?.[1] || '').trim() || null;
      for (const a of attrs.matchAll(/(?:value|data-src|data-url|data-video|data-link|data-embed|data-player|data-server|data-file|data-iframe|data-href|data-player-url|data-video-url|data-embed-url)=["']([^"']+)["']/gi)) addExtra(a[1], label);
    }
    for (const m of String(html).matchAll(/(?:server|player|embed|video|url|file)\s*[:=]\s*["']([^"']+)["']/gi)) addExtra(m[1]);

    // Packed player scripts are placed first so their real display names and
    // media type (for example Asura as HLS) win over generic URL discovery.
    return cleanSources([...tamamoSources, ...packedSources, ...sources, ...extra], 'Servidor');
  } catch { return []; }
}


function donghuaLifeHostOk(value) {
  try {
    const h = new URL(value).hostname.replace(/^www\./i, '').toLowerCase();
    const base = new URL(DONGHUALIFE_BASE).hostname.replace(/^www\./i, '').toLowerCase();
    return h === base;
  } catch { return false; }
}

function cleanDonghuaLifeTitle(value = '', fallback = '') {
  let title = stripTags(value || '').replace(/\s+/g, ' ').trim();
  title = displayText(title);
  title = title.replace(/\s*-\s*\d+\s*Temp(?:orada)?\s*$/i, '').trim();
  title = mediaTitle(title, String(fallback || '').replace(/-/g, ' ').trim());
  return title;
}

function donghuaLifeYearFromWindow(value = '') {
  const m = String(value).match(/<time\b[^>]*datetime=["'][^"']*?(\d{4})[^"']*["'][^>]*>[\s\S]*?<\/time>/i)
    || String(value).match(/\b(20\d{2}|19\d{2})\b/);
  return m ? String(m[1]) : '';
}

function donghuaLifeCardItems(html, finalUrl, kind = 'series', query = '') {
  const wanted = kind === 'movie' ? /^\/movie\/[^/]+\/?$/i : /^\/series\/[^/]+\/?$/i;
  const type = kind === 'movie' ? 'donghualife-movie' : 'donghualife';
  const rows = [];
  const text = String(html || '');
  const anchorRx = /<a\b([^>]*?)href=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi;
  for (const m of text.matchAll(anchorRx)) {
    const href = absolutize(finalUrl, htmlDecode(m[2]));
    if (!href || !donghuaLifeHostOk(href)) continue;
    let u; try { u = new URL(href); } catch { continue; }
    if (!wanted.test(u.pathname)) continue;
    const slug = u.pathname.split('/').filter(Boolean).pop() || '';
    const raw = m[0];
    const alt = htmlDecode(raw.match(/\balt=["']([^"']+)["']/i)?.[1] || '');
    const label = stripTags(m[4] || '');
    const around = text.slice(m.index, Math.min(text.length, m.index + 2800));
    const titleBlock = around.match(/<div\b[^>]*class=["'][^"']*\btitulo\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || '';
    const titleLink = stripTags(titleBlock);
    const title = cleanDonghuaLifeTitle(label || titleLink || alt, slug);
    if (!title) continue;
    const posterUrl = imageFromAnchorRaw(raw, finalUrl) ||
      imageFromAnchorRaw(around.match(/<a\b[\s\S]{0,900}?<\/a>/i)?.[0] || '', finalUrl) || null;
    const date = donghuaLifeYearFromWindow(around);
    rows.push({
      id: donghuaItemId(href, kind),
      type, category: 'donghua', title, originalTitle: title, overview: '',
      posterPath: null, posterUrl, backdropPath: null, rating: 0, date,
      popularity: query ? titleScore(query, title) : 0, originalLanguage: 'zh',
      source: 'Donghua', sourceUrl: href
    });
  }
  const byUrl = new Map();
  for (const item of rows) {
    const prev = byUrl.get(item.sourceUrl);
    if (!prev || (!prev.posterUrl && item.posterUrl) || (item.popularity > prev.popularity)) byUrl.set(item.sourceUrl, item);
  }
  const out = [...byUrl.values()];
  return query ? out.filter(x => x.popularity > 0).sort((a,b)=>b.popularity-a.popularity) : out;
}

async function donghuaLifeCatalog(kind = 'series') {
  if (!DONGHUALIFE_ENABLED) return [];
  const cacheKey = `catalog:${kind}`;
  const cached = donghuaLifeCache.get(cacheKey);
  if (cached && Date.now() - cached.at < 15 * 60 * 1000) return cached.data;
  const path = kind === 'movie' ? '/movies' : '/donghuas';
  const { html, finalUrl } = await fetchHtmlPublic(new URL(path, DONGHUALIFE_BASE).href);
  const data = donghuaLifeCardItems(html, finalUrl, kind).slice(0, 120);
  donghuaLifeCache.set(cacheKey, { at: Date.now(), data });
  return data;
}

async function donghuaLifeSearchItems(query) {
  if (!DONGHUALIFE_ENABLED || !query) return [];
  let direct = [];
  try {
    const u = new URL('/search', DONGHUALIFE_BASE);
    u.searchParams.set('search_api_fulltext', query);
    const { html, finalUrl } = await fetchHtmlPublic(u.href);
    direct = [
      ...donghuaLifeCardItems(html, finalUrl, 'series', query),
      ...donghuaLifeCardItems(html, finalUrl, 'movie', query)
    ];
  } catch {}
  if (direct.length < 5) {
    const [series, movies] = await Promise.all([
      donghuaLifeCatalog('series').catch(() => []),
      donghuaLifeCatalog('movie').catch(() => [])
    ]);
    direct.push(...[...series, ...movies].map(x => ({ ...x, popularity: titleScore(query, x.title) })).filter(x => x.popularity > 0));
  }
  const byUrl = new Map();
  for (const x of direct) {
    const prev = byUrl.get(x.sourceUrl);
    if (!prev || x.popularity > prev.popularity || (!prev.posterUrl && x.posterUrl)) byUrl.set(x.sourceUrl, x);
  }
  return [...byUrl.values()].sort((a,b)=>b.popularity-a.popularity).slice(0, 24);
}

const { details: donghuaLifeDetails, movieDetails: donghuaLifeMovieDetails } = createDonghuaDetailsReader({ baseUrl: DONGHUALIFE_BASE, fetchPage: fetchHtmlPublic });

async function donghuaLifeSources(params) {
  if (!DONGHUALIFE_ENABLED || !params.episodeUrl) return [];
  try {
    const safe = await safeRemoteUrl(params.episodeUrl);
    if (!donghuaLifeHostOk(safe.href) || !/^\/(?:episode|movie)\/[^/]+\/?$/i.test(safe.pathname)) return [];
    const { html, finalUrl } = await fetchHtmlPublic(safe.href);
    if (params.type === 'donghualife' && !sameCatalogPage(safe.href,finalUrl)) return [];
    const generic = extractEmbeddedSources(html, finalUrl, finalUrl).map((x,i)=>({
      ...x, id:`dlife-${i+1}`, origin:'donghualife', provider:x.provider || inferProvider(x.url)
    }));
    const extra = [];
    const add = (raw,label=null) => {
      if (!raw) return;
      let v = decodeJsEscapes(String(raw).trim()).replace(/^['"]|['"]$/g,'');
      if (v.startsWith('//')) v=`https:${v}`;
      const abs = absolutize(finalUrl,v);
      if (!abs || isAdvertisingUrl(abs)) return;
      const direct = sourceTypeFromUrl(abs);
      if (!direct && !looksLikeEmbed(abs)) return;
      extra.push({ id:`dlife-extra-${extra.length+1}`, label:label||inferProvider(abs), type:direct||'embed', url:abs, quality:direct?'Auto':'Servidor', provider:inferProvider(abs), verified:false, fullLength:true, pageUrl:finalUrl, origin:'donghualife' });
    };
    for (const m of String(html).matchAll(/(?:server|player|embed|video|url|file|source)\s*[:=]\s*["']([^"']+)["']/gi)) add(m[1]);
    for (const m of String(html).matchAll(/<(?:iframe|video|source|a|button|input)\b([^>]*?)>/gi)) {
      const attrs=m[1]||'';
      const label=htmlDecode(attrs.match(/(?:title|aria-label|data-name|data-server-name)=["']([^"']+)["']/i)?.[1]||'').trim()||null;
      for (const a of attrs.matchAll(/(?:src|href|value|data-src|data-url|data-video|data-link|data-embed|data-player|data-server|data-file|data-iframe)=["']([^"']+)["']/gi)) add(a[1],label);
    }
    return cleanSources([...generic,...extra], 'Servidor');
  } catch { return []; }
}

const JADE_DYNASTY_URLS = [1,2,3,4].map((n) => `${MUNDODONGHUA_BASE}/donghua/jade-dynasty${n === 1 ? '' : `-${n}`}`);

async function jadeDynastyItems() {
  const results = await Promise.allSettled(JADE_DYNASTY_URLS.map(async (url, idx) => {
    const d = await mundodonghuaDetails(url);
    return {
      id: `jade-dynasty-${idx + 1}`, type: 'donghua', category: 'donghua', title: d.title,
      originalTitle: d.title, overview: d.overview, posterPath: null, posterUrl: d.posterUrl,
      backdropPath: null, rating: 0, date: '', popularity: 1000 - idx, originalLanguage: 'zh',
      source: 'BloqueTV Donghua', sourceUrl: d.url, episodeCount: d.episodeCount, status: d.status
    };
  }));
  return results.map((r, idx) => r.status === 'fulfilled' ? r.value : ({
    id: `jade-dynasty-${idx + 1}`, type: 'donghua', category: 'donghua',
    title: `Jade Dynasty${idx ? ` ${idx + 1}` : ''}`, originalTitle: `Jade Dynasty${idx ? ` ${idx + 1}` : ''}`, overview: '',
    posterPath: null, posterUrl: null, backdropPath: null, rating: 0, date: '', popularity: 1000 - idx, originalLanguage: 'zh',
    source: 'BloqueTV Donghua', sourceUrl: JADE_DYNASTY_URLS[idx], episodeCount: idx < 3 ? 26 : null, status: idx < 3 ? 'Finalizada' : 'En Emisión'
  }));
}

function withCategory(items, category) {
  return (items || []).map((x) => ({ ...normalizeItem(x), category }));
}

async function tmdbDiscoverTv(params = {}) {
  const d = await tmdb('/discover/tv', { include_adult: false, include_null_first_air_dates: false, ...params });
  return d.results || [];
}

async function safeData(fn, fallback = { results: [] }) {
  try { return await fn(); } catch { return fallback; }
}

async function homeGenreItems(movieGenre = null, tvGenre = null) {
  const jobs = [];
  if (movieGenre) jobs.push(safeData(() => tmdb('/discover/movie', { with_genres: movieGenre, sort_by: 'popularity.desc', include_adult: false, page: 1, 'vote_count.gte': 80 })));
  if (tvGenre) jobs.push(safeData(() => tmdb('/discover/tv', { with_genres: tvGenre, sort_by: 'popularity.desc', include_adult: false, page: 1, 'vote_count.gte': 60 })));
  const data = await Promise.all(jobs);
  const seen = new Set();
  return data.flatMap(d => d.results || []).map(normalizeItem).filter(x => {
    const k = `${x.type}:${x.id}`;
    if (seen.has(k) || !x.posterPath) return false;
    seen.add(k); return true;
  }).sort((a,b) => Number(b.popularity||0) - Number(a.popularity||0)).slice(0,18);
}

async function buildHome() {
  if (!TMDB_TOKEN) {
    const cached = hubCache.get('source-home');
    if (cached && Date.now()-cached.at < 600000) return cached.data;
    const [latest, life] = await Promise.all([MUNDODONGHUA_ENABLED ? mundodonghuaLatestItems().catch(()=>[]) : [], DONGHUALIFE_ENABLED ? donghuaLifeCatalog('series').catch(()=>[]) : []]);
    const data = {mode:'sources',featured:[],genres:[{key:'latest',title:'Últimos agregados',subtitle:'Nuevas historias para descubrir',items:latest.slice(0,16)},{key:'donghualife',title:'Descubre más donghuas',subtitle:'Historias para tu próxima sesión',items:life.slice(0,16)}].filter(x=>x.items.length)};
    if (data.genres.length) hubCache.set('source-home',{at:Date.now(),data});
    return data;
  }
  const cacheKey = 'home:2.17';
  const cached = hubCache.get(cacheKey);
  if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached.data;
  const defs = [
    { key:'action', title:'Acción', subtitle:'Ritmo alto, combates y grandes misiones', movie:28, tv:10759 },
    { key:'adventure', title:'Aventura', subtitle:'Viajes, mundos nuevos y grandes desafíos', movie:12, tv:10759 },
    { key:'animation', title:'Animación', subtitle:'Historias animadas para todos los gustos', movie:16, tv:16 },
    { key:'comedy', title:'Comedia', subtitle:'Para desconectar y pasar un buen rato', movie:35, tv:35 },
    { key:'fantasy', title:'Fantasía', subtitle:'Magia, leyendas y universos extraordinarios', movie:14, tv:10765 },
    { key:'scifi', title:'Ciencia ficción', subtitle:'Futuro, tecnología y lo desconocido', movie:878, tv:10765 },
    { key:'crime', title:'Crimen', subtitle:'Misterios, investigaciones y tensión', movie:80, tv:80 },
    { key:'horror', title:'Terror', subtitle:'Historias para ver con las luces apagadas', movie:27, tv:null },
    { key:'family', title:'Familia', subtitle:'Opciones para disfrutar juntos', movie:10751, tv:10751 }
  ];
  const [trend, popularMovies, popularTv, ...genreLists] = await Promise.all([
    safeData(() => tmdb('/trending/all/week', {})),
    safeData(() => tmdb('/movie/popular', { page: 1 })),
    safeData(() => tmdb('/tv/popular', { page: 1 })),
    ...defs.map(g => homeGenreItems(g.movie, g.tv))
  ]);
  let featured = (trend.results || []).filter(x => ['movie','tv'].includes(x.media_type) && x.backdrop_path).map(normalizeItem);
  if (!featured.length) featured = [...(popularMovies.results||[]), ...(popularTv.results||[])].map(normalizeItem).filter(x => x.backdropPath);
  if (!featured.length) featured = genreLists.flat().filter(x => x.backdropPath).slice(0,7);
  if (!featured.length && !genreLists.some(x => x.length)) throw Object.assign(new Error('No se pudo cargar la portada del catálogo.'), { status: 503 });
  const data = {
    featured: featured.slice(0,7),
    genres: defs.map((g,i) => ({ key:g.key, title:g.title, subtitle:g.subtitle, items: genreLists[i] || [] })).filter(g => g.items.length)
  };
  hubCache.set(cacheKey, { at: Date.now(), data });
  return data;
}

async function buildHub(kind) {
  const cacheKey = String(kind || '').toLowerCase();
  const cached = hubCache.get(cacheKey);
  if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached.data;
  let sections = [];
  let catalogMeta = null;
  if (cacheKey === 'movies') {
    const [popular, trending, nowPlaying, topRated] = await Promise.all([
      safeData(() => tmdb('/movie/popular', { page: 1 })), safeData(() => tmdb('/trending/movie/week', {})),
      safeData(() => tmdb('/movie/now_playing', { page: 1 })), safeData(() => tmdb('/movie/top_rated', { page: 1 }))
    ]);
    sections = [
      { key: 'popular', title: 'Más vistos', subtitle: 'Ordenado por popularidad del catálogo', items: (popular.results || []).map(normalizeItem).slice(0, 18) },
      { key: 'top10', title: 'Top 10', subtitle: 'Lo que está marcando tendencia', items: (trending.results || []).map(normalizeItem).slice(0, 10) },
      { key: 'recommended', title: 'Recomendados', subtitle: 'Selección para descubrir algo nuevo', items: (nowPlaying.results || []).map(normalizeItem).slice(0, 18) },
      { key: 'rated', title: 'Mejor valorados', subtitle: 'Puntuación de la comunidad', items: (topRated.results || []).map(normalizeItem).slice(0, 18) }
    ];
  } else if (cacheKey === 'series') {
    const [popular, trending, onAir, topRated] = await Promise.all([
      safeData(() => tmdb('/tv/popular', { page: 1 })), safeData(() => tmdb('/trending/tv/week', {})),
      safeData(() => tmdb('/tv/on_the_air', { page: 1 })), safeData(() => tmdb('/tv/top_rated', { page: 1 }))
    ]);
    sections = [
      { key: 'popular', title: 'Más vistos', subtitle: 'Ordenado por popularidad del catálogo', items: (popular.results || []).map(normalizeItem).slice(0, 18) },
      { key: 'top10', title: 'Top 10', subtitle: 'Series en tendencia esta semana', items: (trending.results || []).map(normalizeItem).slice(0, 10) },
      { key: 'recommended', title: 'Recomendados', subtitle: 'Series que están en emisión', items: (onAir.results || []).map(normalizeItem).slice(0, 18) },
      { key: 'rated', title: 'Mejor valorados', subtitle: 'Puntuación de la comunidad', items: (topRated.results || []).map(normalizeItem).slice(0, 18) }
    ];
  } else if (cacheKey === 'anime') {
    const [latest, popular] = await Promise.all([
      jkanime.catalog(1).catch(() => ({items:[],total:0,pageCount:1})),
      jkanime.catalog(1,'popularidad').catch(() => ({items:[]}))
    ]);
    sections = [
      {key:'popular',title:'Más populares',subtitle:'Historias destacadas del catálogo',items:popular.items.slice(0,18)},
      {key:'recommended',title:'Últimos agregados',subtitle:'Series, películas y especiales para descubrir',items:latest.items.slice(0,18)}
    ];
    catalogMeta = {total:latest.total,pageCount:latest.pageCount};
  } else if (cacheKey === 'donghua') {
    const [jade, catalog, latest, lifeSeries, lifeMovies] = await Promise.all([
      jadeDynastyItems().catch(() => []),
      mundodonghuaCatalogAll().catch(() => ({ total: 0, pageCount: 1, items: [] })),
      mundodonghuaLatestItems().catch(() => []),
      donghuaLifeCatalog('series').catch(() => []),
      donghuaLifeCatalog('movie').catch(() => [])
    ]);
    const all = catalog.items || [];
    const byViews = [...all].sort((a,b) => Number(b.views || b.popularity || 0) - Number(a.views || a.popularity || 0));
    const viewed = byViews.some((x) => Number(x.views || x.popularity || 0) > 0) ? byViews : all;
    sections = [
      { key: 'jade', title: 'Jade Dynasty · 4 temporadas', subtitle: 'Las cuatro temporadas reunidas en BloqueTV', items: jade },
      { key: 'donghualife', title: 'Donghuas para descubrir', subtitle: 'Historias subtituladas en español', items: lifeSeries.slice(0, 18) },
      { key: 'donghua-movies', title: 'Películas Donghua', subtitle: 'Películas de animación china para tu próxima sesión', items: lifeMovies.slice(0, 18) },
      { key: 'popular', title: 'Más vistos', subtitle: 'Títulos ordenados por popularidad y actividad visible', items: viewed.slice(0, 18) },
      { key: 'top10', title: 'Top 10', subtitle: 'Los títulos con mayor popularidad del catálogo', items: viewed.slice(0, 10) },
      { key: 'recommended', title: 'Últimos agregados', subtitle: 'Donghuas incorporados recientemente al catálogo', items: latest.slice(0, 18) },
      { key: 'rated', title: 'Más populares', subtitle: 'Más títulos destacados del catálogo', items: viewed.slice(18, 36) }
    ];
    catalogMeta = { total: catalog.total || all.length, pageCount: catalog.pageCount || 1 };
  } else {
    throw Object.assign(new Error('Categoría no válida.'), { status: 400 });
  }
  const data = { kind: cacheKey, sections, catalog: catalogMeta };
  hubCache.set(cacheKey, { at: Date.now(), data });
  return data;
}

function episodeNumberFromUrl(url) {
  const m = String(url).match(/(?:episodio|capitulo)-(\d+)(?:[/?#]|$)/i);
  return m ? Number(m[1]) : null;
}

function latanimeEpisodePagesFromHtml(html, finalUrl, episode = null) {
  const eps = extractAnchors(html, finalUrl)
    .filter(a => /\/ver\//i.test(a.href))
    .map(a => {
      const imageMatch = String(a.raw || '').match(/(?:data-src|src)=["']([^"']+)["']/i);
      return { ...a, episode: episodeNumberFromUrl(a.href), thumbnail: imageMatch ? absolutize(finalUrl, htmlDecode(imageMatch[1])) : null };
    });
  const unique = [...new Map(eps.map(x => [x.href, x])).values()];
  if (Number.isFinite(episode)) {
    const exact = unique.filter(x => x.episode === episode);
    if (exact.length) return exact.slice(0, 4);
  }
  return unique.slice(0, 1500);
}

async function latanimeEpisodePages(animeUrl, episode = null) {
  try {
    const { html, finalUrl } = await fetchHtmlPublic(animeUrl);
    return latanimeEpisodePagesFromHtml(html, finalUrl, episode);
  } catch { return []; }
}


async function latanimeEpisodeIndex(title, season = null) {
  if (!LATANIME_ENABLED || !title) return { anime: null, episodes: [] };
  const animePages = await latanimeSearchPages(title, season);
  for (const anime of animePages.slice(0, 5)) {
    const pages = await latanimeEpisodePages(anime.url, null);
    const byNumber = new Map();
    for (const ep of pages) {
      if (!Number.isFinite(ep.episode)) continue;
      if (!byNumber.has(ep.episode)) byNumber.set(ep.episode, {
        episode_number: ep.episode,
        name: ep.label && !/^\s*(?:ver|play)?\s*$/i.test(ep.label) ? ep.label : `Capítulo ${ep.episode}`,
        url: ep.href,
        thumbnail: ep.thumbnail || null
      });
    }
    if (byNumber.size) return { anime, episodes: [...byNumber.values()].sort((a,b) => a.episode_number - b.episode_number) };
  }
  return { anime: animePages[0] || null, episodes: [] };
}

async function latanimeSources(params) {
  if (!LATANIME_ENABLED) return [];
  const all = [];

  // Best path: the UI already knows the exact episode page from the anime index.
  if (params.episodeUrl) {
    try {
      const { html, finalUrl } = await fetchHtmlPublic(params.episodeUrl);
      const sources = extractEmbeddedSources(trimLatanimePlaybackHtml(html), finalUrl, finalUrl)
        .map(s => ({ ...s, label: s.provider || s.label || 'Servidor' }));
      all.push(...sources);
      if (all.length) return cleanSources(all, 'Servidor');
    } catch {}
  }

  const animePages = await latanimeSearchPages(params.title, params.season);
  if (!animePages.length) return [];
  for (const anime of animePages.slice(0, 3)) {
    const episodePages = await latanimeEpisodePages(anime.url, params.episode);
    for (const ep of episodePages.slice(0, Number.isFinite(params.episode) ? 2 : 1)) {
      try {
        const { html, finalUrl } = await fetchHtmlPublic(ep.href);
        const sources = extractEmbeddedSources(html, finalUrl, finalUrl)
          .map(s => ({ ...s, label: s.provider || s.label || 'Servidor' }));
        all.push(...sources);
      } catch {}
    }
    if (all.length) break;
  }
  return cleanSources(all, 'Servidor');
}

async function resolvePlayableSources(params) {
  const local = catalogSources(params.type, params.id, params.season, params.episode);
  const [latanime, mundo, external, archive] = await Promise.all([
    latanimeSources(params).catch(() => []),
    mundodonghuaSources(params).catch(() => []),
    externalSourceApi(params),
    archiveSearch(params).catch(() => [])
  ]);
  const seen = new Set();
  return [...local, ...mundo, ...latanime, ...external, ...archive].filter((s) => !seen.has(s.url) && seen.add(s.url));
}

function absolutize(base, value) { try { return new URL(value.replace(/&amp;/g, '&'), base).href; } catch { return null; } }
function discoverMedia(html, base) {
  const map = new Map();
  const add = (raw) => {
    if (!raw || raw.startsWith('data:') || raw.startsWith('blob:')) return;
    const url = absolutize(base, raw.trim());
    const type = sourceTypeFromUrl(url || '');
    if (url && type) map.set(url, { id: `web-${map.size + 1}`, label: `Fuente web ${map.size + 1}`, type, url, quality: 'Web', provider: new URL(base).hostname, fullLength: true });
  };
  for (const m of html.matchAll(/<(?:video|source)[^>]+(?:src|data-src)=["']([^"']+)["']/gi)) add(m[1]);
  for (const m of html.matchAll(/(?:src|href|file|url)\s*[:=]\s*["']([^"']+\.(?:m3u8|mp4|webm|m4v|mov)(?:\?[^"']*)?)["']/gi)) add(m[1]);
  for (const m of html.matchAll(/https?:\\?\/\\?\/[^"'<>\s]+?\.(?:m3u8|mp4|webm|m4v|mov)(?:\?[^"'<>\s]*)?/gi)) add(m[0].replace(/\\\//g, '/'));
  return [...map.values()].slice(0, 80);
}


const downloads = createDownloadService({fetchRemote:fetchPublicWithRedirects, discoverMedia, extractEmbeddedSources});

async function apiRoute(req, res, url) {
  try {
    if (await downloads.handle(req, res, url)) return;
    if (req.method !== 'GET') return json(res, 405, {error:'Método no permitido.'});

    if (url.pathname === '/api/health') return json(res, 200, { ok: true, version: '2.17.5-jkanime-1', jkanimeEnabled: JKANIME_ENABLED, tmdbConfigured: Boolean(TMDB_TOKEN), sourceApiConfigured: Boolean(SOURCE_API_URL), latanimeEnabled: LATANIME_ENABLED, latanimeBase: LATANIME_BASE, mundodonghuaEnabled: MUNDODONGHUA_ENABLED, mundodonghuaBase: MUNDODONGHUA_BASE, donghualifeEnabled: DONGHUALIFE_ENABLED, donghualifeBase: DONGHUALIFE_BASE, catalogEntries: Object.keys(streamCatalog.items || {}).length });

    if (url.pathname === '/api/search') {
      const q = (url.searchParams.get('q') || '').trim();
      if (q.length < 2) return json(res, 400, { error: 'Escribe al menos 2 caracteres.' });
      const [tmdbResult, latanimeResult, mundoResult, donghuaLifeResult, jkanimeResult] = await Promise.allSettled([
        tmdb('/search/multi', { query: q, include_adult: false, page: Math.max(1, Number(url.searchParams.get('page') || 1)) }),
        latanimeSearchItems(q),
        mundodonghuaSearchItems(q),
        donghuaLifeSearchItems(q),
        jkanime.search(q)
      ]);
      const tmdbItems = tmdbResult.status === 'fulfilled'
        ? (tmdbResult.value.results || []).filter((x) => ['movie', 'tv'].includes(x.media_type)).map(normalizeItem).sort((a, b) => b.popularity - a.popularity)
        : [];
      const latanimeItems = latanimeResult.status === 'fulfilled' ? latanimeResult.value : [];
      const mundoItems = mundoResult.status === 'fulfilled' ? mundoResult.value : [];
      const donghuaLifeItems = donghuaLifeResult.status === 'fulfilled' ? donghuaLifeResult.value : [];
      const jkanimeItems = jkanimeResult.status === 'fulfilled' ? jkanimeResult.value.items : [];
      const results = [...jkanimeItems, ...donghuaLifeItems, ...mundoItems, ...latanimeItems, ...tmdbItems];
      if (!results.length && tmdbResult.status === 'rejected' && latanimeResult.status === 'rejected' && mundoResult.status === 'rejected' && donghuaLifeResult.status === 'rejected' && jkanimeResult.status === 'rejected') throw tmdbResult.reason;
      return json(res, 200, { query: q, results, totalResults: results.length, jkanimeResults:jkanimeItems.length, donghualifeResults: donghuaLifeItems.length, mundodonghuaResults: mundoItems.length, latanimeResults: latanimeItems.length, tmdbResults: tmdbItems.length });
    }

    if (url.pathname === '/api/home') return json(res, 200, await buildHome());

    if (url.pathname === '/api/hub') {
      const kind = (url.searchParams.get('kind') || '').trim().toLowerCase();
      return json(res, 200, await buildHub(kind));
    }

    if (url.pathname === '/api/jkanime-catalog') return json(res,200,await jkanime.catalog(url.searchParams.get('page')));
    if (url.pathname === '/api/jkanime-search') return json(res,200,await jkanime.search(url.searchParams.get('q'),url.searchParams.get('page')));
    if (url.pathname === '/api/jkanime-details') return json(res,200,await jkanime.details(url.searchParams.get('url')||''));
    if (url.pathname === '/api/jkanime-episodes') return json(res,200,await jkanime.episodes(url.searchParams.get('url')||'',url.searchParams.get('page'),url.searchParams.get('q')));

    if (url.pathname === '/api/mundodonghua-search') {
      const q = (url.searchParams.get('q') || '').trim();
      if (q.length < 2) return json(res, 400, { error: 'Escribe al menos 2 caracteres.' });
      const results = await mundodonghuaSearchItems(q);
      return json(res, 200, { query: q, results, totalResults: results.length });
    }

    if (url.pathname === '/api/mundodonghua-catalog') {
      const page = Math.max(1, Number(url.searchParams.get('page') || 1));
      return json(res, 200, await mundodonghuaCatalogPage(page));
    }

    if (url.pathname === '/api/mundodonghua-details') {
      const raw = (url.searchParams.get('url') || '').trim();
      if (!raw) return json(res, 400, { error: 'Falta la URL del donghua.' });
      return json(res, 200, await mundodonghuaDetails(raw));
    }

    if (url.pathname === '/api/donghualife-search') {
      const q = (url.searchParams.get('q') || '').trim();
      if (q.length < 2) return json(res, 400, { error: 'Escribe al menos 2 caracteres.' });
      const results = await donghuaLifeSearchItems(q);
      return json(res, 200, { query: q, results, totalResults: results.length });
    }

    if (url.pathname === '/api/donghualife-series-catalog') {
      const results = await donghuaLifeCatalog('series');
      return json(res, 200, { results, totalResults: results.length });
    }

    if (url.pathname === '/api/donghualife-movie-catalog') {
      const results = await donghuaLifeCatalog('movie');
      return json(res, 200, { results, totalResults: results.length });
    }

    if (url.pathname === '/api/donghualife-details') {
      const raw = (url.searchParams.get('url') || '').trim();
      if (!raw) return json(res, 400, { error: 'Falta la URL del donghua.' });
      return json(res, 200, await donghuaLifeDetails(raw));
    }

    if (url.pathname === '/api/donghualife-movie-details') {
      const raw = (url.searchParams.get('url') || '').trim();
      if (!raw) return json(res, 400, { error: 'Falta la URL de la película.' });
      return json(res, 200, await donghuaLifeMovieDetails(raw));
    }

    if (url.pathname === '/api/latanime-search') {
      const q = (url.searchParams.get('q') || '').trim();
      if (q.length < 2) return json(res, 400, { error: 'Escribe al menos 2 caracteres.' });
      const results = await latanimeSearchItems(q);
      return json(res, 200, { query: q, results, count: results.length });
    }

    if (url.pathname === '/api/latanime-details') {
      const animeUrl = (url.searchParams.get('url') || '').trim();
      if (!animeUrl) return json(res, 400, { error: 'Falta la URL del anime.' });
      return json(res, 200, await latanimeAnimeDetails(animeUrl));
    }

    if (url.pathname === '/api/latanime-language-variants') {
      const title = (url.searchParams.get('title') || '').trim();
      const currentUrl = (url.searchParams.get('url') || '').trim();
      if (!title) return json(res, 400, { error: 'Falta el título del anime.' });
      const variants = await latanimeLanguageVariants(title, currentUrl);
      return json(res, 200, { title, variants, count: variants.length });
    }

    if (url.pathname === '/api/latanime-work-variants') {
      const title = (url.searchParams.get('title') || '').trim();
      const currentUrl = (url.searchParams.get('url') || '').trim();
      if (!title) return json(res, 400, { error: 'Falta el título del anime.' });
      const data = await latanimeWorkVariants(title, currentUrl);
      return json(res, 200, { title, ...data, count: data.seasons.length });
    }

    if (url.pathname === '/api/details') {
      const type = url.searchParams.get('type'); const id = Number(url.searchParams.get('id'));
      if (!['movie', 'tv'].includes(type) || !Number.isFinite(id)) return json(res, 400, { error: 'Parámetros inválidos.' });
      const data = await tmdb(`/${type}/${id}`, { append_to_response: 'videos,credits' });
      if (!data.videos?.results?.length) data.videos = await tmdb(`/${type}/${id}/videos`, { language: 'en-US' }).catch(() => ({ results: [] }));
      return json(res, 200, data);
    }

    if (url.pathname === '/api/season') {
      const tvId = Number(url.searchParams.get('tvId')); const season = Number(url.searchParams.get('season'));
      if (!Number.isFinite(tvId) || !Number.isFinite(season)) return json(res, 400, { error: 'Parámetros inválidos.' });
      return json(res, 200, await tmdb(`/tv/${tvId}/season/${season}`));
    }


    if (url.pathname === '/api/latanime-episodes') {
      const title = url.searchParams.get('title') || '';
      const seasonRaw = url.searchParams.get('season');
      const season = seasonRaw === null ? null : Number(seasonRaw);
      if (!title.trim()) return json(res, 400, { error: 'Falta title.' });
      const data = await latanimeEpisodeIndex(title.trim(), Number.isFinite(season) ? season : null);
      return json(res, 200, { title, season, anime: data.anime, episodes: data.episodes, count: data.episodes.length });
    }

    if (url.pathname === '/api/playable-sources') {
      const type = url.searchParams.get('type'); const rawId = url.searchParams.get('id') || '';
      const sourceBacked = type === 'jkanime' || type === 'latanime' || type === 'donghua' || type === 'donghualife' || type === 'donghualife-movie';
      const id = sourceBacked ? rawId : Number(rawId);
      const title = (url.searchParams.get('title') || '').trim(); const yr = (url.searchParams.get('year') || '').trim();
      const seasonRaw = url.searchParams.get('season'); const episodeRaw = url.searchParams.get('episode');
      const season = seasonRaw === null ? null : Number(seasonRaw); const episode = episodeRaw === null ? null : Number(episodeRaw);
      if (!['movie', 'tv', 'latanime', 'donghua', 'donghualife', 'donghualife-movie', 'jkanime'].includes(type) || (!sourceBacked && !Number.isFinite(id)) || !title) return json(res, 400, { error: 'Faltan datos del título.' });
      const params = { type, id, title, year: yr, season, episode, episodePageUrl:url.searchParams.get('episodePageUrl')||'', episodeName: url.searchParams.get('episodeName') || '', episodeUrl: url.searchParams.get('episodeUrl') || '' };
      if (type === 'donghualife') {
        const listUrl = url.searchParams.get('episodePageUrl') || '';
        if (!donghuaLifeHostOk(listUrl) || !filterDonghuaEpisodes([{url:params.episodeUrl,episode_number:episode}],listUrl,season).length)
          return json(res, 400, {error:'El capítulo no corresponde a la temporada seleccionada. Vuelve a abrir la ficha.'});
      }
      const sources = type === 'jkanime' ? cleanSources(await jkanime.sources(params))
        : type === 'latanime' ? await latanimeSources(params)
        : type === 'donghua' ? await mundodonghuaSources(params)
        : (type === 'donghualife' || type === 'donghualife-movie') ? await donghuaLifeSources(params)
        : await resolvePlayableSources(params);
      return json(res, 200, { type, id, title, season, episode, sources, count: sources.length });
    }

    if (url.pathname === '/api/analyze-url') {
      const input = (url.searchParams.get('url') || '').trim();
      const safe = await safeRemoteUrl(input);
      const {response:r,finalUrl:finalHref} = await fetchPublicWithRedirects(safe.href, {headers:{'user-agent':'Mozilla/5.0 BloqueTV/2.17.5',accept:'text/html,video/*;q=0.9,*/*;q=0.8'},signal:AbortSignal.timeout(15000)});
      if (!r.ok) {await r.body?.cancel();return json(res,502,{error:`La fuente respondió ${r.status}.`});}
      const finalUrl = new URL(finalHref);
      const ct = (r.headers.get('content-type') || '').toLowerCase();
      const direct = !/html|json/.test(ct) && (sourceTypeFromUrl(finalUrl.href) || (/mpegurl/.test(ct) ? 'hls' : ct.startsWith('video/') ? 'mp4' : null));
      if(direct || !ct.includes('html')) await r.body?.cancel();
      if (direct) return json(res, 200, { pageUrl: finalUrl.href, title: finalUrl.hostname, media: [{ id: 'direct', label: 'Video directo', type: direct, url: finalUrl.href, quality: 'Auto', provider: finalUrl.hostname, fullLength: true }] });
      if (!ct.includes('html')) return json(res, 200, { pageUrl: finalUrl.href, title: finalUrl.hostname, media: [] });
      const html = await readTextLimited(r,5000000);
      const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]+>/g, '').trim() || finalUrl.hostname;
      return json(res, 200, { pageUrl: finalUrl.href, title, media: [...new Map([...discoverMedia(html, finalUrl.href), ...extractEmbeddedSources(html,finalUrl.href,finalUrl.href)].map(s=>[s.url,{...s,pageUrl:finalUrl.href}])).values()] });
    }

    return json(res, 404, { error: 'Endpoint no encontrado.' });
  } catch (e) {
    console.error('[API]', e);
    if (res.headersSent) { try { res.destroy(e); } catch {} return; }
    return json(res, e.status || 500, { error: e.message || 'Error interno.', code: e.code || null });
  }
}

async function serveStatic(req, res, url) {
  let path;
  try {path=decodeURIComponent(url.pathname);} catch {return json(res,400,{error:'Ruta no válida.'});}
  if (path === '/') path = '/index.html';
  const safePath = normalize(path).replace(/^([.][.][/\\])+/, '');
  let filePath = join(publicDir, safePath);
  if (!filePath.startsWith(publicDir)) return json(res, 403, { error: 'Forbidden' });
  try { const info = await stat(filePath); if (info.isDirectory()) filePath = join(filePath, 'index.html'); }
  catch { return json(res,404,{error:'Archivo no encontrado.'}); }
  securityHeaders(res);
  const ext = extname(filePath).toLowerCase();
  res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
  res.setHeader('Cache-Control', ['.html', '.js', '.css', '.webmanifest'].includes(ext) ? 'no-cache, no-store, must-revalidate' : 'public, max-age=604800');
  createReadStream(filePath).on('error', () => json(res, 404, { error: 'Archivo no encontrado.' })).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) return await apiRoute(req,res,url);
    return await serveStatic(req,res,url);
  } catch {if(!res.headersSent)json(res,400,{error:'Solicitud no válida.'});else res.destroy();}
});
server.listen(PORT, () => console.log(`BloqueTV 2.17.5 · Seasons · JKAnime → http://localhost:${server.address().port}`));
