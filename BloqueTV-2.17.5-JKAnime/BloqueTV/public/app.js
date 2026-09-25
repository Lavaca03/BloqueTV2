import { createDownloads } from './downloads.js';
import { displayText, mediaTitle } from './display-text.js';
import { filterDonghuaDetail, filterDonghuaEpisodes } from './episode-identity.js';
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const content = $('#content');
const searchInput = $('#globalSearch');
const IMAGE = 'https://image.tmdb.org/t/p/';
const state = {
  viewController: new AbortController(), sourceRequest: 0, catalogRequest: 0, route: 'home', query: '', searchResults: [], timer: null, activeDetail: null, donghuaCatalogPage: 1, donghuaCatalogTimer: null, animeCatalogTimer: null, animeCatalogController: null, homeCarouselTimer: null,
  favorites: load('nexus2:favorites', []), history: load('nexus2:history', []), downloads: load('nexus2:downloads', []), customSources: load('nexus2:customSources', {})
};
let activeHls = null;

function load(k,f) {try{const value=JSON.parse(localStorage.getItem(k));return (Array.isArray(f)?Array.isArray(value):value&&typeof value==='object'&&!Array.isArray(value))?value:f;}catch{return f;}}
function save(k,v) {try{localStorage.setItem(k,JSON.stringify(v));}catch{toast('No se pudo guardar el historial en este navegador.');}}
function esc(v='') { return String(v).replace(/[&<>'"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[m])); }
function escText(value, fallback='') { return esc(displayText(value, fallback)); }
function img(p, s='w500') { return p ? `${IMAGE}${s}${p}` : ''; }
function year(d) { return d ? String(d).slice(0,4) : '—'; }
function typeLabel(t) { return t === 'movie' ? 'PELÍCULA' : ['latanime','jkanime'].includes(t) ? 'ANIME' : (t === 'donghua' || t === 'donghualife') ? 'DONGHUA' : t === 'donghualife-movie' ? 'PELÍCULA DONGHUA' : 'SERIE'; }
function badgeLabel(i) { return i?.category === 'anime' ? 'ANIME' : i?.category === 'donghua' ? 'DONGHUA' : typeLabel(i?.type); }
function canonicalAnimeViewTitle(value=''){
  return displayText(value,'')
    .replace(/\b(?:español\s+latino|audio\s+latino|latino|castellano|español\s+(?:de\s+)?españa|sub(?:titulado)?(?:\s+(?:al\s+)?español)?|sub\s*esp(?:añol)?)\b/gi,' ')
    .replace(/\b(?:temporada|season)\s*(?:n(?:º|°)?\s*)?\d+\b/gi,' ')
    .replace(/\b\d+(?:st|nd|rd|th)\s+season\b/gi,' ')
    .replace(/\b\d+(?:ra|da|ta)\s+temporada\b/gi,' ')
    .replace(/\b(?:t|s)\s*[-_.]?\s*\d+\b/gi,' ')
    .replace(/[\[\]{}()|·•]+/g,' ')
    .replace(/\s*[-–—:]\s*$/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}
function canonicalAnimeViewKey(value=''){
  return canonicalAnimeViewTitle(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
}
function animeSeasonNumber(value=''){
  const raw=displayText(value,'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const patterns=[/\b(?:temporada|season)\s*(?:n\s*)?(\d{1,2})\b/i,/\b(\d{1,2})(?:st|nd|rd|th)\s+season\b/i,/\b(\d{1,2})(?:ra|da|ta)\s+temporada\b/i,/\b(?:t|s)\s*[-_.]?\s*(\d{1,2})\b/i];
  for(const rx of patterns){const m=raw.match(rx);if(m){const n=Number(m[1]);if(Number.isFinite(n)&&n>0)return n;}}return 1;
}
function animeLanguageInfo(value=''){
  const raw=displayText(value,'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  if(/\b(?:espanol latino|audio latino|latino)\b/.test(raw))return {key:'latino',label:'Español latino'};
  if(/\b(?:castellano|espanol de espana|espanol espana)\b/.test(raw))return {key:'castellano',label:'Castellano'};
  if(/\b(?:sub espanol|subtitulado espanol|subtitulado|sub esp|sub)\b/.test(raw))return {key:'sub-espanol',label:'Sub español'};
  return {key:'disponible',label:'Idioma disponible'};
}
function keyOf(x) {
  if(x?.type==='latanime'){
    const work=canonicalAnimeViewKey(x.title||x.originalTitle||x.variantTitle||'');
    if(work)return `latanime-work:${work}`;
  }
  if(['donghualife','donghualife-movie'].includes(x?.type)&&x.sourceUrl){try{const u=new URL(x.sourceUrl);u.search='';u.hash='';return `${x.type}:${u.href.replace(/\/$/,'')}`;}catch{}}
  return `${x.type}:${x.id}`;
}
function collapseAnimeViews(items=[]){
  const result=[];const positions=new Map();
  for(const raw of items||[]){
    if(raw?.type!=='latanime'){result.push(raw);continue;}
    const title=canonicalAnimeViewTitle(raw.title||raw.originalTitle||raw.variantTitle||'')||raw.title;
    const item={...raw,title,originalTitle:title};const key=keyOf(item);
    if(!positions.has(key)){positions.set(key,result.length);result.push(item);continue;}
    const index=positions.get(key);const current=result[index];
    const rank=v=>/\blatino\b/i.test(`${v?.variantTitle||''} ${v?.sourceUrl||''}`)?3:/\bcastellano\b/i.test(`${v?.variantTitle||''} ${v?.sourceUrl||''}`)?2:/\b(?:sub|subtitulado)\b/i.test(`${v?.variantTitle||''} ${v?.sourceUrl||''}`)?1:0;
    if(rank(item)>rank(current))result[index]=item;
  }
  return result;
}
function toast(msg) { const e=document.createElement('div'); e.className='toast'; e.textContent=displayText(msg); $('#toastRegion').append(e); setTimeout(()=>e.remove(),5200); }
async function api(path,options={}) {
  const signal=options.signal||AbortSignal.any([state.viewController.signal,AbortSignal.timeout(60000)]);
  const r=await fetch(path,{...options,signal});const d=await r.json().catch(()=>({}));signal.throwIfAborted();
  if(!r.ok)throw new Error(d.error||'No se pudo completar la solicitud.');return d;
}
const downloads=createDownloads({esc,toast,onChange:count=>{const b=$('#activeDownloadBadge');if(b){b.hidden=!count;b.textContent=count;}}});
function downloadSource(source,title){return downloads.open(source,title);}
const routes=['home','search','anime','donghua','series','movies','favorites','history','downloads'];
let navigationIndex=history.state?.nexusIndex||0;
let navigationMax=navigationIndex;try{navigationMax=Math.max(navigationIndex,Number(sessionStorage.getItem('nexus2:navigationMax'))||0);}catch{}
let sourceController=null;
function syncNavigation(){
  const active=state.route==='detail'?state.parentRoute:state.route;
  $$('.nav-item[data-route]').forEach(b=>{const selected=b.dataset.route===active;b.classList.toggle('active',selected);if(selected)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
  $('#navBack').disabled=navigationIndex<=0;$('#navForward').disabled=navigationIndex>=navigationMax;
  document.title=`${state.route==='detail'?displayText(state.activeDetail?.title,'Detalles'):({home:'Inicio',search:'Buscar',anime:'Anime',donghua:'Donghuas',series:'Series',movies:'Películas',favorites:'Favoritos',history:'Historial',downloads:'Descargas'})[state.route]||'BloqueTV'} · BloqueTV`;
}
function snapshot(){return {nexusIndex:navigationIndex,route:state.route,query:state.query,item:state.activeDetail,parentRoute:state.parentRoute,scroll:window.scrollY};}
function rememberScroll(){history.replaceState({...history.state,scroll:window.scrollY},'');}
function beginView(route){
  stopHomeCarousel();clearTimeout(state.timer);clearTimeout(state.donghuaCatalogTimer);clearTimeout(state.animeCatalogTimer);state.animeCatalogController?.abort();state.viewController.abort();state.viewController=new AbortController();
  state.sourceRequest++;state.catalogRequest++;sourceController?.abort();closePlayer();setMenu(false);state.route=route;
}
function commitNavigation(replace=false){
  if(!replace){navigationIndex++;navigationMax=navigationIndex;try{sessionStorage.setItem('nexus2:navigationMax',String(navigationMax));}catch{}}
  const hash=state.route==='search'?`#/search?q=${encodeURIComponent(state.query)}`:state.route==='detail'?`#/detail/${encodeURIComponent(state.activeDetail.type)}/${encodeURIComponent(state.activeDetail.id)}`:`#/${state.route}`;
  history[replace?'replaceState':'pushState'](snapshot(),'',hash);syncNavigation();
}
function goBack(){if(navigationIndex>0)history.back();else setRoute('home');}
function setMenu(open){
  document.body.classList.toggle('menu-open',open);$('#menuToggle')?.setAttribute('aria-expanded',String(open));$('#menuBackdrop').hidden=!open;
  if(open)$('#menuClose').focus();
}
function stopHomeCarousel(){ if(state.homeCarouselTimer){clearInterval(state.homeCarouselTimer);state.homeCarouselTimer=null;} }
function setRoute(route,{restore=false,scroll=0}={}) {
  const invalidRoute=!routes.includes(route);if(invalidRoute)route='home';if(!restore)rememberScroll();beginView(route);state.activeDetail=null;
  if(!restore)commitNavigation();else if(invalidRoute)commitNavigation(true);else syncNavigation();
  const signal=state.viewController.signal;const result=renderRoute();
  if(!restore)window.scrollTo({top:0,behavior:'instant'});
  Promise.resolve(result).then(()=>{if(!signal.aborted){window.scrollTo({top:scroll,behavior:'instant'});content.focus({preventScroll:true});}});
}
function addHistory(q) { const v=q.trim(); if(!v)return; state.history=[{query:v,at:Date.now()},...state.history.filter(x=>x.query.toLowerCase()!==v.toLowerCase())].slice(0,30); save('nexus2:history',state.history); }
function isFavorite(i){return state.favorites.some(x=>keyOf(x)===keyOf(i));}
function toggleFavorite(i){state.favorites=isFavorite(i)?state.favorites.filter(x=>keyOf(x)!==keyOf(i)):[i,...state.favorites];save('nexus2:favorites',state.favorites);toast(isFavorite(i)?'Guardado en favoritos':'Quitado de favoritos');}
function customKey(type,id,season=null,episode=null){return [type,id,season??'',episode??''].join(':');}
function getCustom(type,id,season=null,episode=null){return state.customSources[customKey(type,id,season,episode)]||[];}
function addCustom(type,id,title,season=null,episode=null){
  const url=prompt('Pega una URL directa MP4 o HLS (.m3u8) que tengas autorización para reproducir:'); if(!url)return;
  const clean=normalizeUrl(url);if(!clean)return toast('Enlace no válido.'); const t=/\.m3u8(?:\?|$)/i.test(clean)?'hls':/\.(mp4|m4v|webm|mov)(?:\?|$)/i.test(clean)?'mp4':null;
  if(!t)return toast('La URL debe ser un MP4/WebM/MOV o un HLS .m3u8 directo.');
  const k=customKey(type,id,season,episode); const entry={id:`custom-${Date.now()}`,label:'Fuente personal',type:t,url:clean,quality:'Auto',provider:'Fuente añadida',fullLength:true};
  state.customSources[k]=[entry,...(state.customSources[k]||[]).filter(x=>x.url!==clean)]; save('nexus2:customSources',state.customSources); toast('Fuente añadida.'); return entry;
}

function ensurePlayer(){
  let m=$('#playerModal'); if(m)return m;
  m=document.createElement('div');m.id='playerModal';m.className='player-modal';m.setAttribute('role','dialog');m.setAttribute('aria-label','Reproductor de video');m.setAttribute('aria-modal','true');m.innerHTML=`<div class="player-shell"><div class="player-topbar"><div class="player-heading"><span class="player-brand"><img src="/assets/bloquetv-icon.svg" alt="" width="25" height="25">BLOQUETV PLAYER</span><h2 id="playerTitle">Reproducción</h2></div><div class="player-top-actions"><button id="playerDownload" class="player-download">↓ Descargar</button><button id="playerClose" class="player-close" aria-label="Cerrar reproductor">×</button></div></div><div class="player-serverbar"><div class="serverbar-title"><strong>Servidores</strong><span id="playerServerCount">0 disponibles</span></div><div id="playerSources" class="player-sources"></div></div><div id="playerStage" class="player-stage"></div><div class="player-bottom"><div id="playerMeta" class="player-meta"></div><span class="player-hint">Cambia de servidor sin salir del capítulo</span></div></div>`;document.body.append(m);
  $('#playerClose',m).onclick=closePlayer;m.onclick=e=>{if(e.target===m)closePlayer();};return m;
}
function destroyPlayback(){const video=$('#playerStage video');if(video){video.dispatchEvent(new Event('pause'));video.onerror=null;video.pause();video.removeAttribute('src');video.load();}if(activeHls){try{activeHls.destroy();}catch{}activeHls=null;}const s=$('#playerStage');if(s)s.innerHTML='';}
let playerReturnFocus=null;
function closePlayer(){const wasOpen=$('#playerModal')?.classList.contains('open');destroyPlayback();$('#playerModal')?.classList.remove('open');document.body.classList.remove('player-open');if(wasOpen&&playerReturnFocus?.isConnected)playerReturnFocus.focus({preventScroll:true});}
function sourceText(s){
  const server=displayText(s.provider||s.label,'Servidor');
  const quality=s.quality&&s.quality!=='Servidor'?displayText(s.quality):null;
  return [server,quality,s.type?String(s.type).toUpperCase():null].filter(Boolean).join(' · ');
}
function playerSources(sources=[]){
  const best=new Map(); const rank={hls:5,mp4:5,webm:5,mov:5,embed:3,youtube:1};
  for(const s of sources.filter(Boolean)){
    const server=String(s.provider||s.label||s.url||'servidor').trim().toLowerCase();
    const quality=String(s.quality||'').trim().toLowerCase();
    const key=String(s.url||`${server}|${quality}`);
    const prev=best.get(key);
    if(!prev||(rank[s.type]||2)>(rank[prev.type]||2))best.set(key,s);
  }
  return [...best.values()];
}
function attachSource(source,title){
  destroyPlayback(); const stage=$('#playerStage'); const meta=$('#playerMeta'); const dl=$('#playerDownload'); if(dl){dl.disabled=source.type==='youtube';dl.onclick=()=>downloadSource(source,title);} meta.textContent=[displayText(source.provider),source.license?'Licencia disponible':null,source.type==='embed'?'Reproductor del proveedor':'Reproductor nativo'].filter(Boolean).join(' · ');
  if(source.type==='youtube'){const id=String(source.url).match(/^[\w-]{6,20}$/)?.[0]||new URL(source.url).searchParams.get('v');stage.innerHTML=`<iframe class="youtube-player" src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(id||'')}?autoplay=1" allow="autoplay;encrypted-media;picture-in-picture;fullscreen" allowfullscreen title="${escText(title)}"></iframe>`;return;}
  if(source.type==='embed'){stage.innerHTML=`<iframe class="embed-player" src="${esc(source.url)}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" referrerpolicy="origin-when-cross-origin" allowfullscreen title="${escText(title)}"></iframe>`;return;}
  const v=document.createElement('video');v.className='html5-player';v.controls=true;v.autoplay=true;v.playsInline=true;v.preload='metadata';stage.append(v);
  const watch=load('nexus2:watch',{});const watchKey=title;let lastSaved=0;
  v.addEventListener('loadedmetadata',()=>{const previous=watch[watchKey];if(previous&&previous.time>10&&v.duration-previous.time>15)v.currentTime=previous.time;});
  const saveProgress=()=>{if(!Number.isFinite(v.duration)||v.duration<=0)return;watch[watchKey]={title,source,time:v.currentTime,duration:v.duration,at:Date.now()};const recent=Object.entries(watch).sort((a,b)=>b[1].at-a[1].at).slice(0,30);save('nexus2:watch',Object.fromEntries(recent));};
  v.addEventListener('timeupdate',()=>{if(Date.now()-lastSaved>5000){lastSaved=Date.now();saveProgress();}});v.addEventListener('pause',saveProgress);v.addEventListener('ended',saveProgress);
  const fail=()=>{if(activeHls){activeHls.destroy();activeHls=null;}stage.innerHTML=`<div class="player-error"><strong>Esta fuente no respondió al reproductor.</strong><span>Prueba otro servidor de la lista.</span></div>`;};
  v.onerror=fail;
  if(source.type==='hls'){
    if(v.canPlayType('application/vnd.apple.mpegurl')){v.src=source.url;v.play().catch(()=>{});return;}
    if(window.Hls?.isSupported?.()){activeHls=new Hls({enableWorker:true});activeHls.loadSource(source.url);activeHls.attachMedia(v);activeHls.on(Hls.Events.MANIFEST_PARSED,()=>v.play().catch(()=>{}));activeHls.on(Hls.Events.ERROR,(_,d)=>{if(d?.fatal)fail();});return;}
    return fail();
  }
  v.src=source.url;v.play().catch(()=>{});
}
function openPlayer(sources,title,startIndex=0){
  const list=playerSources(sources);if(!list.length)return toast('No hay fuentes reproducibles.');playerReturnFocus=document.activeElement;const m=ensurePlayer();$('#playerTitle',m).textContent=displayText(title,'Reproducción');
  const count=$('#playerServerCount',m);if(count)count.textContent=`${list.length} ${list.length===1?'disponible':'disponibles'}`;
  $('#playerSources',m).innerHTML=list.map((s,i)=>`<button class="source-chip ${i?'':'active'}" data-src="${i}" title="${esc(sourceText(s))}"><span class="source-dot"></span><span>${escText(s.provider||s.label,`Servidor ${i+1}`)}</span>${s.quality&&s.quality!=='Servidor'?`<small>${escText(s.quality)}</small>`:''}</button>`).join('');
  $$('[data-src]',m).forEach(b=>b.onclick=()=>{$$('[data-src]',m).forEach(x=>x.classList.toggle('active',x===b));attachSource(list[Number(b.dataset.src)],title);});m.classList.add('open');document.body.classList.add('player-open');const selected=Math.max(0,list.findIndex(s=>s.url===sources[startIndex]?.url));$$('[data-src]',m).forEach((b,i)=>b.classList.toggle('active',i===selected));attachSource(list[selected],title);$('#playerClose').focus();
}

document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!document.querySelector('dialog[open]')){closePlayer();setMenu(false);}if((e.key==='/'||((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'))&&!document.querySelector('dialog[open]')&&!['INPUT','TEXTAREA'].includes(document.activeElement?.tagName)){e.preventDefault();searchInput.focus();}});

function resultCard(i,options={}){
  // `Array.map(resultCard)` passes the array index as the second argument.
  // Rankings must therefore be explicit via { rank }, otherwise search results
  // accidentally inherit the Top 10 numbers.
  const rank=Number(options && typeof options==='object' ? options.rank : 0);
  const hasRank=Number.isInteger(rank)&&rank>0;
  const n={id:i.id,type:i.type,category:i.category,title:i.title,overview:i.overview,posterPath:i.posterPath,posterUrl:i.posterUrl,backdropPath:i.backdropPath,rating:i.rating,date:i.date,source:i.source,sourceUrl:i.sourceUrl,episodeCount:i.episodeCount,status:i.status,views:i.views};
  const poster=i.posterUrl||img(i.posterPath,'w342');
  const sourceMeta=i.type==='jkanime'?`<span>${escText(i.format||'Anime')}</span><span>${escText(i.status||'Disponible')}</span>`:i.type==='latanime'?`<span>Episodios</span><span>${i.episodeCount?`${i.episodeCount} disponibles`:'Disponible'}</span>`:i.type==='donghua'?`<span>Donghua</span><span>${Number(i.views||0)>0?`${Number(i.views).toLocaleString('es-ES')} vistas`:i.episodeCount?`${i.episodeCount} eps`:'Sub Español'}</span>`:i.type==='donghualife'?`<span>Donghua</span><span>${i.episodeCount?`${i.episodeCount} eps`:'Sub Español'}</span>`:i.type==='donghualife-movie'?`<span>Película Donghua</span><span>${year(i.date)}</span>`:`<span>${year(i.date)}</span><span>★ ${Number(i.rating||0).toFixed(1)}</span>`;
  return `<article tabindex="0" role="button" aria-label="Ver ${escText(i.title)}" class="media-card ${hasRank?'ranked-card':''}" data-open="${esc(encodeURIComponent(JSON.stringify(n)))}">${hasRank?`<div class="rank-number">${rank}</div>`:''}<div class="poster-wrap">${poster?`<img class="poster" src="${esc(poster)}" alt="${escText(i.title)}" loading="lazy">`:'<div class="poster-empty">▶</div>'}<span class="card-badge">${badgeLabel(i)}</span><span class="play-overlay">▶</span></div><h3>${escText(i.title)}</h3><p>${sourceMeta}</p></article>`;
}
function bindCards(){ $$('[data-open]').forEach(e=>{e.onclick=()=>openDetail(JSON.parse(decodeURIComponent(e.dataset.open)));e.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();e.click();}};}); $$('[data-route]').forEach(e=>e.onclick=()=>setRoute(e.dataset.route)); }

function homeGenreIcon(key){return ({action:'⚡',adventure:'◈',animation:'✦',comedy:'☺',fantasy:'✧',scifi:'◌',crime:'◆',horror:'☾',family:'♡'})[key]||'●';}
function homeItemData(i){return {id:i.id,type:i.type,category:i.category,title:i.title,overview:i.overview,posterPath:i.posterPath,posterUrl:i.posterUrl,backdropPath:i.backdropPath,rating:i.rating,date:i.date,source:i.source,sourceUrl:i.sourceUrl,episodeCount:i.episodeCount,status:i.status,views:i.views};}
function bindHomeCarousel(count){
  stopHomeCarousel(); if(!count)return; let current=0; const slides=$$('.home-slide');const dots=$$('.home-dot');
  const show=(n)=>{current=(n+count)%count;slides.forEach((x,i)=>x.classList.toggle('active',i===current));dots.forEach((x,i)=>x.classList.toggle('active',i===current));};
  const start=()=>{stopHomeCarousel();if(count>1&&!matchMedia('(prefers-reduced-motion: reduce)').matches)state.homeCarouselTimer=setInterval(()=>show(current+1),6500);};
  $('#homePrev')?.addEventListener('click',()=>{show(current-1);start();});$('#homeNext')?.addEventListener('click',()=>{show(current+1);start();});
  dots.forEach((d,i)=>d.addEventListener('click',()=>{show(i);start();}));
  const hero=$('.home-carousel');hero?.addEventListener('mouseenter',stopHomeCarousel);hero?.addEventListener('mouseleave',start);start();
}
function renderSourceHome(genres=[],loading=false){
  const saved=load('nexus2:watch',{});const watching=Object.values(saved).filter(x=>x.source&&x.time>10&&x.duration-x.time>15).sort((a,b)=>b.at-a.at).slice(0,4);
  content.innerHTML=`<section class="welcome-hero"><div class="welcome-copy"><span class="hero-tag"><span class="status-dot ok"></span> TU ESPACIO MULTIMEDIA</span><h1>Una buena historia.<br><em>A tu manera.</em></h1><p>Descubre, reproduce y lleva tus videos contigo.<br>Todo empieza con lo que quieres ver.</p><div class="actions"><button class="btn btn-primary" data-route="search">Buscar un título <span>↗</span></button></div></div><div class="welcome-art" aria-hidden="true"><div class="orbit orbit-one"></div><div class="orbit orbit-two"></div><div class="logo-card"><img src="/assets/bloquetv-logo.png" alt="" width="1254" height="1254"></div><div class="art-caption"><span class="status-dot ok"></span> DALE PLAY A TU MOMENTO</div></div><span class="hero-edition">BLOQUETV / TU ESPACIO MULTIMEDIA</span></section><section class="quick-explore" aria-label="Explorar categorías">${[['anime','✦','Anime','Nuevas aventuras'],['donghua','◈','Donghuas','Mundos por descubrir'],['series','▣','Series','Un episodio más'],['movies','◉','Películas','Tu próxima función']].map(([r,i,t,d])=>`<button data-route="${r}"><span class="quick-icon">${i}</span><span><strong>${t}</strong><small>${d}</small></span><b>↗</b></button>`).join('')}</section>${watching.length?`<section class="section"><div class="section-head"><div><span class="eyebrow">A TU RITMO</span><h2>Continúa viendo</h2></div></div><div class="continue-grid">${watching.map((x,i)=>`<button class="continue-card" data-continue="${i}"><span class="continue-play">▶</span><strong>${escText(x.title)}</strong><small>${Math.floor(x.time/60)} min vistos · ${Math.ceil((x.duration-x.time)/60)} min restantes</small><progress value="${x.time}" max="${x.duration}" aria-label="Progreso de reproducción"></progress></button>`).join('')}</div></section>`:''}${state.favorites.length?`<section class="section"><div class="section-head"><div><span class="eyebrow">TU SELECCIÓN</span><h2>A un clic de volver</h2></div><button class="text-button" data-route="favorites">Ver favoritos →</button></div><div class="media-rail">${collapseAnimeViews(state.favorites).slice(0,8).map(i=>resultCard(i)).join('')}</div></section>`:''}<div id="homeCollections">${genres.map(g=>`<section class="section"><div class="section-head"><div><span class="eyebrow">${escText(g.subtitle||'DESCUBRE')}</span><h2>${escText(g.title)}</h2></div><button class="text-button" data-route="donghua">Explorar →</button></div><div class="media-rail">${g.items.map(i=>resultCard(i)).join('')}</div></section>`).join('')}${loading?'<div class="home-source-loading"><span class="loader-dot"></span> Actualizando las colecciones disponibles…</div>':!genres.length?'<div class="home-tip"><span>⌕</span><div><strong>Encuentra tu próxima historia</strong><p>Busca un título, elige un capítulo y empieza a verlo. Tus videos descargados se reúnen en Descargas.</p></div><button class="text-button" data-route="downloads">Ir a Descargas →</button></div>':''}</div>`;
  bindCards();$$('[data-continue]').forEach(b=>b.onclick=()=>{const x=watching[Number(b.dataset.continue)];openPlayer([x.source],x.title);});
}
async function renderHome(){
  stopHomeCarousel();renderSourceHome([],true);
  try{
    const d=await api('/api/home');if(state.route!=='home')return;if(!d.featured?.length){renderSourceHome(d.genres||[]);return;}
    const featured=(d.featured||[]).slice(0,7);const genres=(d.genres||[]).filter(g=>g.items?.length);
    const slides=featured.map((i,idx)=>{const data=encodeURIComponent(JSON.stringify(homeItemData(i)));const bg=img(i.backdropPath||i.posterPath,'original');const explore=i.type==='movie'?'movies':'series';return `<article class="home-slide ${idx===0?'active':''}" style="background-image:url('${esc(bg)}')"><div class="home-slide-overlay"></div><div class="home-slide-content"><span class="home-kicker"><b>DESTACADO</b><i>${badgeLabel(i)}</i></span><h1>${escText(i.title)}</h1><div class="home-meta"><span>${year(i.date)}</span><span>★ ${Number(i.rating||0).toFixed(1)}</span><span>${i.type==='movie'?'Película':'Serie'}</span></div><p>${escText(i.overview||'Descubre este título dentro del catálogo de BloqueTV.')}</p><div class="home-actions"><button class="home-play" data-open="${data}">▶ Ver detalles</button><button class="home-more" data-route="${explore}">Explorar ${i.type==='movie'?'películas':'series'}</button></div></div></article>`;}).join('');
    const dots=featured.map((_,i)=>`<button class="home-dot ${i===0?'active':''}" aria-label="Ir al destacado ${i+1}"></button>`).join('');
    const genreNav=genres.map(g=>`<button class="genre-pill" data-genre-jump="${esc(g.key)}"><span>${homeGenreIcon(g.key)}</span>${escText(g.title)}</button>`).join('');
    const genreSections=genres.map(g=>`<section class="home-genre-section" id="home-genre-${esc(g.key)}"><div class="section-head home-section-head"><div><span class="genre-mini">${homeGenreIcon(g.key)} GÉNERO</span><h2>${escText(g.title)}</h2><p>${escText(g.subtitle||'Títulos seleccionados para explorar')}</p></div><div class="rail-controls"><button data-home-rail-left="${esc(g.key)}">‹</button><button data-home-rail-right="${esc(g.key)}">›</button></div></div><div class="media-rail home-media-rail" id="home-rail-${esc(g.key)}">${g.items.map(i=>resultCard(i)).join('')}</div></section>`).join('');
    content.innerHTML=`<section class="home-carousel">${slides}<button class="home-arrow prev" id="homePrev" aria-label="Anterior">‹</button><button class="home-arrow next" id="homeNext" aria-label="Siguiente">›</button><div class="home-dots">${dots}</div></section><section class="home-discover"><div class="home-discover-head"><div><span class="eyebrow">EXPLORA A TU MANERA</span><h2>Encuentra algo por género</h2></div><p>Acción, fantasía, comedia y mucho más.</p></div><div class="genre-pills">${genreNav}</div></section>${genreSections}`;
    bindCards();bindHomeCarousel(featured.length);
    $$('[data-genre-jump]').forEach(b=>b.onclick=()=>document.getElementById(`home-genre-${b.dataset.genreJump}`)?.scrollIntoView({behavior:'smooth',block:'start'}));
    $$('[data-home-rail-left]').forEach(b=>b.onclick=()=>$('#home-rail-'+CSS.escape(b.dataset.homeRailLeft))?.scrollBy({left:-700,behavior:'smooth'}));
    $$('[data-home-rail-right]').forEach(b=>b.onclick=()=>$('#home-rail-'+CSS.escape(b.dataset.homeRailRight))?.scrollBy({left:700,behavior:'smooth'}));
  }catch(e){
    if(state.route!=='home'||e.name==='AbortError')return;renderSourceHome();
  }
}

async function performSearch(q,push=false,{restore=false}={}) {
  q=q.trim();if(q.length<2){toast('Escribe al menos 2 caracteres.');return;}
  const replace=state.route==='search'&&!push; if(!restore)rememberScroll();beginView('search');
  state.query=q;state.searchResults=[];searchInput.value=q;if(push)addHistory(q);if(!restore)commitNavigation(replace);else syncNavigation();
  content.innerHTML=`<div class="workspace-heading"><div><span class="eyebrow">BUSCANDO EN TUS FUENTES</span><h1>“${esc(q)}”</h1><p>Preparando resultados…</p></div><span class="loader-dot"></span></div><div class="media-grid skeleton-grid">${Array.from({length:8},()=>'<div class="skeleton-card"></div>').join('')}</div>`;
  try{const d=await api(`/api/search?q=${encodeURIComponent(q)}`);state.searchResults=collapseAnimeViews(d.results||[]);renderSearch();}catch(e){renderError(e);}
}
function renderSearch(){
  const items=state.searchResults;
  content.innerHTML=state.query?`<div class="workspace-heading"><div><span class="eyebrow">${items.length} RESULTADOS</span><h1>“${esc(state.query)}”</h1><p>Elige un título para ver sus episodios y servidores.</p></div></div>${items.length?`<div class="media-grid search-results-grid">${items.map(i=>resultCard(i)).join('')}</div>`:'<div class="empty-state"><h2>No encontramos ese título</h2><p>Prueba el nombre original o usa menos palabras.</p><button class="btn btn-ghost" id="focusSearch">Cambiar búsqueda</button></div>'}`:`<section class="search-welcome"><span class="eyebrow">ENCUENTRA TU PRÓXIMA HISTORIA</span><h1>¿Qué quieres ver?</h1><p>Escribe un título en el buscador de arriba.</p><div class="recent-chips">${state.history.slice(0,6).map(x=>`<button data-history="${esc(x.query)}">${esc(x.query)}</button>`).join('')}</div><button class="btn btn-primary" id="focusSearch">Buscar un título</button></section>`;
  bindCards();$('#focusSearch')?.addEventListener('click',()=>searchInput.focus());$$('[data-history]').forEach(b=>b.onclick=()=>performSearch(b.dataset.history,true));
}

async function openDetail(item,{restore=false}={}){
  if(!restore){rememberScroll();state.parentRoute=state.route==='detail'?state.parentRoute:state.route;}beginView('detail');state.activeDetail=item;if(!restore)commitNavigation();else syncNavigation();window.scrollTo({top:0,behavior:'instant'});content.innerHTML='<div class="detail-loading">Cargando título…</div>';
  try{
    if(item.type==='jkanime'){
      const d=await api(`/api/jkanime-details?url=${encodeURIComponent(item.sourceUrl||'')}`);
      return renderJkAnimeDetail(item,d);
    }
    if(item.type==='latanime'){
      const d=await api(`/api/latanime-details?url=${encodeURIComponent(item.sourceUrl||'')}`);
      return renderLatanimeDetail(item,d);
    }
    if(item.type==='donghua'){
      const d=await api(`/api/mundodonghua-details?url=${encodeURIComponent(item.sourceUrl||'')}`);
      return renderDonghuaDetail(item,d);
    }
    if(item.type==='donghualife'){
      const d=await api(`/api/donghualife-details?url=${encodeURIComponent(item.sourceUrl||'')}`);
      return renderDonghuaLifeDetail(item,d);
    }
    if(item.type==='donghualife-movie'){
      const d=await api(`/api/donghualife-movie-details?url=${encodeURIComponent(item.sourceUrl||'')}`);
      return renderDonghuaLifeMovieDetail(item,d);
    }
    if(item.category==='donghua'&&item.type==='tv'){
      try{
        const m=await api(`/api/mundodonghua-search?q=${encodeURIComponent(item.title||'')}`);
        if(m.results?.length){
          const best=m.results[0];
          const d=await api(`/api/mundodonghua-details?url=${encodeURIComponent(best.sourceUrl||'')}`);
          return renderDonghuaDetail({...best,posterPath:item.posterPath,backdropPath:item.backdropPath,rating:item.rating,date:item.date},d);
        }
      }catch(e){if(e.name==='AbortError')throw e;}
    }
    const d=await api(`/api/details?type=${item.type}&id=${item.id}`);renderDetail(item,d);
  }catch(e){renderError(e);}
}
function renderLatanimeDetail(item,d){
  const title=canonicalAnimeViewTitle(item.title||d.title)||d.title||item.title;const poster=d.posterUrl||item.posterUrl||'';const episodes=d.episodes||[];
  const normalized={...item,title,posterUrl:poster,overview:d.overview||item.overview||'',sourceUrl:d.url||item.sourceUrl,type:'latanime'};
  content.innerHTML=`<section class="detail-hero latanime-detail"><div class="detail-bg" style="background-image:url('${esc(poster)}')"></div><button class="back-btn" id="detailBack">← Volver</button><div class="detail-inner">${poster?`<img class="detail-poster" src="${esc(poster)}" alt="${escText(title)}">`:''}<div class="detail-copy"><span class="eyebrow">ANIME</span><h1>${escText(title)}</h1><div class="detail-meta"><span>${escText(d.dateText||'')}</span><span>${episodes.length||d.episodeCount||0} capítulos</span></div><p>${escText(d.overview||'')}</p><div class="actions"><button class="btn btn-ghost" id="favBtn">${isFavorite(normalized)?'♥ Guardado':'♡ Favorito'}</button></div></div></div></section><section class="section source-section"><div class="section-head"><div><h2>Opciones de reproducción</h2><p>Selecciona un capítulo; los servidores aparecerán dentro de BloqueTV Player.</p></div></div><div id="sourceArea" class="source-area"><div class="source-callout"><div class="source-radar">◎</div><div><strong>Elige un capítulo</strong><span>BloqueTV analizará la página exacta del episodio y extraerá sus servidores.</span></div></div></div></section><section class="section"><div class="section-head"><div><h2>Episodios</h2><p>Lista de episodios disponibles</p></div></div><div id="episodeArea"></div></section>`;
  $('#detailBack').onclick=goBack;
  $('#favBtn').onclick=()=>{toggleFavorite(normalized);renderLatanimeDetail(item,d);};
  renderSourceEpisodeList($('#episodeArea'),item.id,title,'',episodes,{title:d.title||title,url:d.url},'latanime');
}

function renderDonghuaDetail(item,d){
  const title=d.title||item.title;const poster=d.posterUrl||item.posterUrl||img(item.posterPath,'w500')||'';const episodes=d.episodes||[];
  const normalized={...item,title,posterUrl:poster,overview:d.overview||item.overview||'',sourceUrl:d.url||item.sourceUrl,type:'donghua',category:'donghua'};
  content.innerHTML=`<section class="detail-hero donghua-detail"><div class="detail-bg" style="background-image:url('${esc(poster)}')"></div><button class="back-btn" id="detailBack">← Volver</button><div class="detail-inner">${poster?`<img class="detail-poster" src="${esc(poster)}" alt="${escText(title)}">`:''}<div class="detail-copy"><span class="eyebrow">DONGHUA</span><h1>${escText(title)}</h1><div class="detail-meta"><span>${escText(d.status||item.status||'Sub Español')}</span><span>${episodes.length||d.episodeCount||0} capítulos</span></div><p>${escText(d.overview||item.overview||'')}</p><div class="actions"><button class="btn btn-ghost" id="favBtn">${isFavorite(normalized)?'♥ Guardado':'♡ Favorito'}</button></div></div></div></section><section class="section source-section"><div class="section-head"><div><h2>Opciones de reproducción</h2><p>Selecciona un capítulo; sus servidores aparecerán dentro de BloqueTV Player.</p></div></div><div id="sourceArea" class="source-area"><div class="source-callout"><div class="source-radar">◎</div><div><strong>Elige un capítulo</strong><span>BloqueTV analizará el episodio y preparará sus servidores disponibles.</span></div></div></div></section><section class="section"><div class="section-head"><div><h2>Episodios</h2><p>Lista de episodios disponibles</p></div></div><div id="episodeArea"></div></section>`;
  $('#detailBack').onclick=goBack;
  $('#favBtn').onclick=()=>{toggleFavorite(normalized);renderDonghuaDetail(item,d);};
  renderSourceEpisodeList($('#episodeArea'),item.id,title,'',episodes,{title,url:d.url},'donghua');
}


function invalidateEpisodeSources(){
  state.sourceRequest++;sourceController?.abort();closePlayer();
  const area=$('#sourceArea');if(area)area.innerHTML='<div class="source-callout"><div class="source-radar">◎</div><div><strong>Elige un capítulo</strong><span>Los servidores corresponden a la selección actual.</span></div></div>';
}

function refreshDetailMetadata(item){
  state.activeDetail=item;syncNavigation();history.replaceState(snapshot(),'');
  const index=state.favorites.findIndex(x=>keyOf(x)===keyOf(item));
  if(index>=0){state.favorites[index]={...state.favorites[index],...item};save('nexus2:favorites',state.favorites);}
}

function renderDonghuaLifeDetail(item,d){
  d=filterDonghuaDetail(d,item.sourceUrl);
  item={...item,id:d.id||item.id};
  const title=mediaTitle(d.title,item.title,'Donghua');const poster=d.posterUrl||item.posterUrl||'';const seasons=(d.seasons||[]).filter(s=>s.episodes?.length);
  const normalized={...item,title,posterUrl:poster,overview:d.overview||item.overview||'',sourceUrl:d.url||item.sourceUrl,type:'donghualife',category:'donghua',episodeCount:d.episodeCount||0,status:d.status||item.status};
  refreshDetailMetadata(normalized);
  const genres=(d.genres||[]).slice(0,8);
  content.innerHTML=`<section class="detail-hero donghua-detail"><div class="detail-bg" style="background-image:url('${esc(poster)}')"></div><button class="back-btn" id="detailBack">← Volver</button><div class="detail-inner">${poster?`<img class="detail-poster" src="${esc(poster)}" alt="${escText(title)}">`:''}<div class="detail-copy"><span class="eyebrow">DONGHUA</span><h1>${escText(title)}</h1><div class="detail-meta">${d.dateText?`<span>${escText(d.dateText)}</span>`:''}${d.status?`<span>${escText(d.status)}</span>`:''}${d.duration?`<span>${escText(d.duration)}</span>`:''}<span>${Number(d.episodeCount||0)} capítulos</span></div>${genres.length?`<div class="detail-meta">${genres.map(g=>`<span>${escText(g)}</span>`).join('')}</div>`:''}<p>${escText(d.overview||item.overview||'')}</p><div class="actions"><button class="btn btn-ghost" id="favBtn">${isFavorite(normalized)?'♥ Guardado':'♡ Favorito'}</button></div></div></div></section><section class="section source-section"><div class="section-head"><div><h2>Opciones de reproducción</h2><p>Selecciona un capítulo para elegir un servidor dentro de BloqueTV Player.</p></div></div><div id="sourceArea" class="source-area"><div class="source-callout"><div class="source-radar">◎</div><div><strong>Elige un capítulo</strong><span>Los servidores se preparan dentro de BloqueTV Player.</span></div></div></div></section><section class="section"><div class="section-head"><div><h2>Temporadas y episodios</h2><p>${seasons.length>1?`${seasons.length} temporadas · `:''}${Number(d.episodeCount||0)} capítulos encontrados</p></div></div><div id="episodeArea"></div></section>`;
  $('#detailBack').onclick=goBack;
  $('#favBtn').onclick=()=>{toggleFavorite(normalized);renderDonghuaLifeDetail(item,d);};
  const target=$('#episodeArea');
  if(!seasons.length){target.innerHTML='<div class="empty-state compact"><h2>No se encontraron capítulos</h2><p>Todavía no hay una lista de episodios disponible para este título.</p></div>';return;}
  const renderSeason=(ss,index,box)=>{
    const seasonTitle=ss.special?`${title} · ${ss.label||ss.title||'Especial'}`:title;
    const sourceTitle=ss.special?seasonTitle:`${title} · Temporada ${ss.season_number||index+1}`;
    const itemId=ss.special?`${item.id}:${encodeURIComponent(ss.url)}`:item.id;
    renderSourceEpisodeList(box,itemId,seasonTitle,d.dateText||'',ss.episodes,{title:sourceTitle,url:ss.url},'donghualife',ss.special?null:ss.season_number||index+1);
  };
  if(seasons.length===1){renderSeason(seasons[0],0,target);return;}
  target.innerHTML=`<div class="season-tabs">${seasons.map((ss,i)=>`<button data-dlife-season="${i}" class="${i?'':'active'}">${ss.special?escText(ss.label||ss.title||'Especial'):`T${ss.season_number||i+1}`}</button>`).join('')}</div><div id="donghuaLifeEpisodeList"></div>`;
  const showSeason=(index)=>{
    const ss=seasons[index];const box=$('#donghuaLifeEpisodeList');
    if(!ss||!box)return;
    $$('[data-dlife-season]',target).forEach((b,i)=>b.classList.toggle('active',i===index));
    invalidateEpisodeSources();renderSeason(ss,index,box);
  };
  $$('[data-dlife-season]',target).forEach((b,i)=>b.onclick=()=>showSeason(i));showSeason(0);
}

function renderDonghuaLifeMovieDetail(item,d){
  item={...item,id:d.id||item.id};
  const title=mediaTitle(d.title,item.title,'Donghua');const poster=d.posterUrl||item.posterUrl||'';const genres=(d.genres||[]).slice(0,8);
  const normalized={...item,title,posterUrl:poster,overview:d.overview||item.overview||'',sourceUrl:d.url||item.sourceUrl,type:'donghualife-movie',category:'donghua',date:d.dateText||item.date};
  refreshDetailMetadata(normalized);
  content.innerHTML=`<section class="detail-hero donghua-detail"><div class="detail-bg" style="background-image:url('${esc(poster)}')"></div><button class="back-btn" id="detailBack">← Volver</button><div class="detail-inner">${poster?`<img class="detail-poster" src="${esc(poster)}" alt="${escText(title)}">`:''}<div class="detail-copy"><span class="eyebrow">PELÍCULA DONGHUA</span><h1>${escText(title)}</h1><div class="detail-meta">${d.dateText?`<span>${escText(d.dateText)}</span>`:''}${d.duration?`<span>${escText(d.duration)}</span>`:''}${genres.map(g=>`<span>${escText(g)}</span>`).join('')}</div><p>${escText(d.overview||item.overview||'')}</p><div class="actions"><button class="btn btn-primary" id="searchSources">▶ Buscar video</button><button class="btn btn-ghost" id="favBtn">${isFavorite(normalized)?'♥ Guardado':'♡ Favorito'}</button></div></div></div></section><section class="section source-section"><div class="section-head"><div><h2>Opciones de reproducción</h2><p>BloqueTV analizará la página de la película y mostrará sus servidores compatibles dentro del reproductor.</p></div></div><div id="sourceArea" class="source-area"><div class="source-callout"><div class="source-radar">◎</div><div><strong>Pulsa “Buscar video”</strong><span>Los servidores disponibles aparecerán dentro de BloqueTV Player.</span></div></div></div></section>`;
  $('#detailBack').onclick=goBack;
  $('#favBtn').onclick=()=>{toggleFavorite(normalized);renderDonghuaLifeMovieDetail(item,d);};
  $('#searchSources').onclick=()=>showSources('donghualife-movie',item.id,title,d.dateText||item.date,null,null,[],'',false,d.url||item.sourceUrl||'');
}

function hubTitle(kind){return ({anime:'Anime',donghua:'Donghuas',series:'Series',movies:'Películas'})[kind]||'Explorar';}
function hubEyebrow(kind){return ({anime:'ANIMACIÓN JAPONESA',donghua:'ANIMACIÓN CHINA',series:'SERIES',movies:'PELÍCULAS'})[kind]||'BLOQUETV';}
function hubDescription(kind){return ({anime:'Explora el catálogo completo de anime, películas y especiales. Busca una historia y elige sus capítulos dentro de BloqueTV.',donghua:'Descubre donghuas y películas de animación china. Elige una historia y explora sus temporadas y capítulos.',series:'Series populares, tendencias, recomendaciones y las mejor valoradas.',movies:'Películas populares, tendencias, recomendaciones y las mejor valoradas.'})[kind]||'';}

function animeCatalogShell(meta={}){
  const total=Number(meta.total||0);
  return `<section class="hub-section donghua-catalog-section"><div class="section-head catalog-head"><div><h2>Catálogo completo</h2><p>${total?`${total.toLocaleString('es-ES')} títulos disponibles`:'Explora todos los títulos disponibles'} · series, películas y especiales.</p></div><div class="catalog-search"><span>⌕</span><input id="animeCatalogSearch" aria-label="Buscar en el catálogo Anime" placeholder="Buscar dentro de Anime…" autocomplete="off"></div></div><div id="animeCatalogGrid" aria-live="polite"><div class="detail-loading">Cargando catálogo…</div></div><div id="animeCatalogPager" class="catalog-pager"></div></section>`;
}
function bindPageControls(pager,d,loadPage){
  if((d.pageCount||1)<=1){pager.innerHTML='';return;}
  pager.innerHTML=`<button data-page="1" aria-label="Primera página" ${d.page<=1?'disabled':''}>«</button><button data-page="${d.page-1}" aria-label="Página anterior" ${d.page<=1?'disabled':''}>←</button><span>Página <strong>${d.page}</strong> de ${d.pageCount}</span><button data-page="${d.page+1}" aria-label="Página siguiente" ${d.page>=d.pageCount?'disabled':''}>→</button><button data-page="${d.pageCount}" aria-label="Última página" ${d.page>=d.pageCount?'disabled':''}>»</button>`;
  $$('[data-page]',pager).forEach(b=>b.onclick=()=>loadPage(Number(b.dataset.page)));
}
async function loadAnimeCatalog(page=1,query=''){
  const requestId=++state.catalogRequest,grid=$('#animeCatalogGrid'),pager=$('#animeCatalogPager');if(!grid||!pager)return;
  state.animeCatalogController?.abort();state.animeCatalogController=new AbortController();
  const signal=AbortSignal.any([state.viewController.signal,state.animeCatalogController.signal,AbortSignal.timeout(35000)]);
  const q=String(query||'').trim();grid.innerHTML='<div class="detail-loading">Cargando títulos…</div>';pager.innerHTML='';
  if(q.length===1){grid.innerHTML='<div class="empty-state compact"><p>Escribe al menos 2 caracteres para buscar.</p></div>';return;}
  try{
    const d=await api(q?`/api/jkanime-search?q=${encodeURIComponent(q)}&page=${page}`:`/api/jkanime-catalog?page=${page}`,{signal});
    if(requestId!==state.catalogRequest||!grid.isConnected)return;
    grid.innerHTML=d.items?.length?`<div class="catalog-summary"><strong>${Number(d.total||0).toLocaleString('es-ES')} ${q?'resultados':'títulos'}</strong><span>Página ${d.page} de ${d.pageCount}</span></div><div class="media-grid">${d.items.map(i=>resultCard(i)).join('')}</div>`:`<div class="empty-state compact"><h2>${q?'Sin coincidencias':'No hay títulos en esta página'}</h2><p>${q?'Prueba el nombre original o una búsqueda más específica.':'Inténtalo nuevamente en unos momentos.'}</p></div>`;
    bindPageControls(pager,d,p=>loadAnimeCatalog(p,q));bindCards();
  }catch(e){
    if(e.name==='AbortError'||requestId!==state.catalogRequest||!grid.isConnected)return;
    grid.innerHTML=`<div class="empty-state compact"><h2>No se pudo cargar el catálogo</h2><p>${escText(e.message)}</p><button class="btn btn-ghost" id="retryAnimeCatalog">Reintentar</button></div>`;
    $('#retryAnimeCatalog',grid).onclick=()=>loadAnimeCatalog(page,q);
  }
}
function bindAnimeCatalogSearch(){
  const input=$('#animeCatalogSearch');if(!input)return;
  input.oninput=()=>{clearTimeout(state.animeCatalogTimer);state.catalogRequest++;state.animeCatalogController?.abort();state.animeCatalogTimer=setTimeout(()=>loadAnimeCatalog(1,input.value),350);};
  input.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();clearTimeout(state.animeCatalogTimer);loadAnimeCatalog(1,input.value);}};
}
function renderJkAnimeDetail(item,d){
  const title=d.title||item.title,poster=d.posterUrl||item.posterUrl||'';
  const normalized={...item,id:d.id||item.id,title,posterUrl:poster,overview:d.overview||item.overview||'',sourceUrl:d.url||item.sourceUrl,type:'jkanime',category:'anime',date:d.dateText,episodeCount:d.episodeCount};
  refreshDetailMetadata(normalized);
  const metadata=[d.dateText,d.format,d.status,d.language,d.duration,`${d.episodeCount||0} capítulos`,...(d.genres||[]).slice(0,6)].filter(Boolean);
  content.innerHTML=`<section class="detail-hero latanime-detail"><div class="detail-bg" style="background-image:url('${esc(poster)}')"></div><button class="back-btn" id="detailBack">← Volver</button><div class="detail-inner">${poster?`<img class="detail-poster" src="${esc(poster)}" alt="${escText(title)}">`:''}<div class="detail-copy"><span class="eyebrow">ANIME</span><h1>${escText(title)}</h1><div class="detail-meta">${metadata.map(v=>`<span>${escText(v)}</span>`).join('')}</div><p>${escText(normalized.overview)}</p><div class="actions"><button class="btn btn-ghost" id="favBtn">${isFavorite(normalized)?'♥ Guardado':'♡ Favorito'}</button></div></div></div></section><section class="section source-section"><div class="section-head"><div><h2>Opciones de reproducción</h2><p>Selecciona un capítulo; sus servidores aparecerán dentro de BloqueTV Player.</p></div></div><div id="sourceArea" class="source-area"><div class="source-callout"><div class="source-radar">◎</div><div><strong>Elige un capítulo</strong><span>Encuentra los servidores disponibles dentro del reproductor.</span></div></div></div></section><section class="section"><div class="section-head"><div><h2>Episodios</h2><p>Explora las páginas o busca un capítulo por su número.</p></div></div><div id="episodeArea"><div class="episode-tools"><label>Encuentra un capítulo<input id="jkEpisodeSearch" type="search" inputmode="decimal" placeholder="Número del capítulo" autocomplete="off"></label><span class="episode-count" id="jkEpisodeCount"></span></div><div id="jkEpisodeList" aria-live="polite"></div><div id="jkEpisodePager" class="catalog-pager"></div></div></section>`;
  $('#detailBack').onclick=goBack;
  const favoriteButton=$('#favBtn');favoriteButton.onclick=()=>{toggleFavorite(normalized);favoriteButton.textContent=isFavorite(normalized)?'♥ Guardado':'♡ Favorito';};
  const list=$('#jkEpisodeList'),pager=$('#jkEpisodePager'),search=$('#jkEpisodeSearch'),count=$('#jkEpisodeCount');
  let requestId=0,timer,controller;
  function display(data){
    count.textContent=data.error?'':data.query?`${data.episodes.length} coincidencias`:`${data.total} capítulos`;
    if(data.error){list.innerHTML=`<div class="empty-state compact"><h2>No se pudo cargar la lista</h2><p>${escText(data.error)}</p><button class="btn btn-ghost" id="retryJkEpisodes">Reintentar</button></div>`;$('#retryJkEpisodes',list).onclick=()=>loadPage(data.page||1,data.query||'');pager.innerHTML='';return;}
    if(data.episodes.length)renderSourceEpisodeList(list,normalized.id,title,d.dateText,data.episodes,{title,url:normalized.sourceUrl},'jkanime',null,null,{remoteSearch:true,total:data.total,query:data.query});
    else list.innerHTML=`<div class="empty-state compact"><h2>${data.query?'No se encontró ese capítulo':'Todavía no hay capítulos disponibles'}</h2><p>${data.query?'Comprueba el número o borra la búsqueda para volver a la lista.':escText(d.status||'Vuelve a consultar más adelante.')}</p></div>`;
    bindPageControls(pager,data,p=>loadPage(p,data.query||''));
  }
  async function loadPage(page=1,query=''){
    clearTimeout(timer);const id=++requestId;controller?.abort();controller=new AbortController();
    const signal=AbortSignal.any([state.viewController.signal,controller.signal,AbortSignal.timeout(60000)]);
    invalidateEpisodeSources();list.innerHTML='<div class="detail-loading">Cargando capítulos…</div>';pager.innerHTML='';count.textContent='';
    try{
      if(query&&!/^\d{1,6}(?:\.\d{1,2})?$/.test(query)){display({episodes:[],total:0,page:1,pageCount:1,query});return;}
      const params=new URLSearchParams({url:normalized.sourceUrl,page:String(page),q:query});
      const data=await api(`/api/jkanime-episodes?${params}`,{signal});
      if(id===requestId&&list.isConnected)display(data);
    }catch(e){if(e.name!=='AbortError'&&id===requestId&&list.isConnected)display({error:e.message,page,query});}
  }
  search.oninput=()=>{clearTimeout(timer);requestId++;controller?.abort();invalidateEpisodeSources();timer=setTimeout(()=>{if(list.isConnected)loadPage(1,search.value.trim());},350);};
  search.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();loadPage(1,search.value.trim());}};
  display(d.episodePage||{episodes:d.episodes||[],total:d.episodeCount||0,page:1,pageCount:1});
}

function donghuaCatalogShell(meta={}){
  const total=Number(meta.total||0);
  return `<section class="hub-section donghua-catalog-section"><div class="section-head catalog-head"><div><h2>Catálogo completo</h2><p>${total?`${total.toLocaleString('es-ES')} títulos disponibles`:'Explora todos los títulos disponibles'} · nombres y temporadas organizados por BloqueTV.</p></div><div class="catalog-search"><span>⌕</span><input id="donghuaCatalogSearch" placeholder="Buscar dentro de Donghuas…" autocomplete="off"></div></div><div id="donghuaCatalogGrid"><div class="detail-loading">Cargando catálogo…</div></div><div id="donghuaCatalogPager" class="catalog-pager"></div></section>`;
}

async function loadDonghuaCatalog(page=1,query=''){
  const requestId=++state.catalogRequest;const grid=$('#donghuaCatalogGrid');const pager=$('#donghuaCatalogPager');if(!grid||!pager)return;
  const q=String(query||'').trim();
  grid.innerHTML='<div class="detail-loading">Cargando títulos…</div>';pager.innerHTML='';
  try{
    let d;
    if(q.length>=2){
      d=await api(`/api/mundodonghua-search?q=${encodeURIComponent(q)}`);if(requestId!==state.catalogRequest||!grid.isConnected)return;
      grid.innerHTML=d.results?.length?`<div class="catalog-summary"><strong>${d.results.length} coincidencias</strong><span>Resultados del catálogo Donghua</span></div><div class="media-grid">${d.results.map(i=>resultCard(i)).join('')}</div>`:`<div class="empty-state compact"><h2>Sin coincidencias</h2><p>Prueba otra forma de escribir el nombre.</p></div>`;
      bindCards();return;
    }
    if(q.length===1){grid.innerHTML='<div class="empty-state compact"><p>Escribe al menos 2 caracteres para filtrar.</p></div>';return;}
    d=await api(`/api/mundodonghua-catalog?page=${Math.max(1,Number(page)||1)}`);if(requestId!==state.catalogRequest||!grid.isConnected)return;
    state.donghuaCatalogPage=d.page||1;
    grid.innerHTML=d.items?.length?`<div class="catalog-summary"><strong>${Number(d.total||0).toLocaleString('es-ES')} títulos</strong><span>Página ${d.page} de ${d.pageCount}</span></div><div class="media-grid">${d.items.map(resultCard).join('')}</div>`:'<div class="empty-state compact"><h2>No se pudo cargar esta página</h2></div>';
    if((d.pageCount||1)>1){
      pager.innerHTML=`<button id="catalogPrev" ${d.page<=1?'disabled':''}>← Anterior</button><span>Página <strong>${d.page}</strong> de ${d.pageCount}</span><button id="catalogNext" ${d.page>=d.pageCount?'disabled':''}>Siguiente →</button>`;
      $('#catalogPrev')?.addEventListener('click',()=>loadDonghuaCatalog(Math.max(1,d.page-1),''));
      $('#catalogNext')?.addEventListener('click',()=>loadDonghuaCatalog(Math.min(d.pageCount,d.page+1),''));
    }
    bindCards();
  }catch(e){if(e.name==='AbortError'||requestId!==state.catalogRequest)return;grid.innerHTML=`<div class="empty-state compact"><h2>No se pudo cargar el catálogo</h2><p>${escText(e.message)}</p></div>`;}
}

function bindDonghuaCatalogSearch(){
  const input=$('#donghuaCatalogSearch');if(!input)return;
  input.addEventListener('input',()=>{clearTimeout(state.donghuaCatalogTimer);state.donghuaCatalogTimer=setTimeout(()=>loadDonghuaCatalog(1,input.value),350);});
  input.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();clearTimeout(state.donghuaCatalogTimer);loadDonghuaCatalog(1,input.value);}});
}

async function renderHub(kind){
  stopHomeCarousel();const title=hubTitle(kind);state.route=kind;
  content.innerHTML=`<section class="hub-hero hub-${kind}"><div class="hub-orb"></div><span class="eyebrow">${hubEyebrow(kind)}</span><h1>${title}</h1><p>${esc(hubDescription(kind))}</p><div class="hub-loading"><span class="loader-dot"></span> Cargando colecciones…</div></section>`;
  try{
    const d=await api(`/api/hub?kind=${encodeURIComponent(kind)}`);
    const sections=(d.sections||[]).filter(x=>x.items?.length);if(!sections.length&&!['donghua','anime'].includes(kind)){content.innerHTML=`<section class="search-welcome"><span class="eyebrow">${hubEyebrow(kind)}</span><h1>${title}</h1><p>No hay colecciones disponibles ahora. Usa el buscador para encontrar un título.</p><div class="actions"><button class="btn btn-primary" data-route="search">Buscar título</button></div></section>`;bindCards();return;}
    const pills=kind==='anime'?'<span>Más populares</span><span>Últimos agregados</span><span>Catálogo completo</span>':kind==='donghua'?'<span>Donghua</span><span>Películas Donghua</span><span>Más vistos</span><span>Últimos agregados</span><span>Catálogo completo</span>':'<span>Más vistos</span><span>Top 10</span><span>Recomendados</span><span>Mejor valorados</span>';
    const catalogBlock=kind==='donghua'?donghuaCatalogShell(d.catalog||{}):kind==='anime'?animeCatalogShell(d.catalog||{}):'';
    content.innerHTML=`<section class="hub-hero hub-${kind}"><div class="hub-orb"></div><span class="eyebrow">${hubEyebrow(kind)}</span><h1>${title}</h1><p>${esc(hubDescription(kind))}</p><div class="hub-pills">${pills}</div></section>${sections.map(sec=>`<section class="hub-section"><div class="section-head"><div><h2>${escText(sec.title)}</h2><p>${escText(sec.subtitle||'')}</p></div><div class="rail-controls"><button data-rail-left="${esc(sec.key)}">‹</button><button data-rail-right="${esc(sec.key)}">›</button></div></div><div class="media-rail ${sec.key==='top10'?'top10-rail':''}" id="rail-${esc(sec.key)}">${sec.items.map((i,idx)=>resultCard(i,sec.key==='top10'?{rank:idx+1}:{})).join('')}</div></section>`).join('')}${catalogBlock}`;
    bindCards();
    $$('[data-rail-left]').forEach(b=>b.onclick=()=>$('#rail-'+CSS.escape(b.dataset.railLeft))?.scrollBy({left:-650,behavior:'smooth'}));
    $$('[data-rail-right]').forEach(b=>b.onclick=()=>$('#rail-'+CSS.escape(b.dataset.railRight))?.scrollBy({left:650,behavior:'smooth'}));
    if(kind==='donghua'){bindDonghuaCatalogSearch();loadDonghuaCatalog(1,'');}
    if(kind==='anime'){bindAnimeCatalogSearch();loadAnimeCatalog(1,'');}
  }catch(e){renderError(e);}
}

function trailerOf(v=[]){return v.find(x=>x.site==='YouTube'&&x.type==='Trailer'&&x.official)||v.find(x=>x.site==='YouTube'&&x.type==='Trailer')||null;}
function renderDetail(item,d){
  const type=item.type; const title=d.title||d.name||item.title; const date=d.release_date||d.first_air_date||item.date; const poster=d.poster_path||item.posterPath; const back=d.backdrop_path||item.backdropPath; const normalized={...item,title,posterPath:poster,backdropPath:back,date};
  const trailer=trailerOf(d.videos?.results||[]);
  content.innerHTML=`<section class="detail-hero"><div class="detail-bg" style="background-image:url('${img(back||poster,'original')}')"></div><button class="back-btn" id="detailBack">← Volver</button><div class="detail-inner">${poster?`<img class="detail-poster" src="${img(poster,'w500')}" alt="${escText(title)}">`:''}<div class="detail-copy"><span class="eyebrow">${badgeLabel(normalized)}</span><h1>${escText(title)}</h1><div class="detail-meta"><span>${year(date)}</span><span>★ ${Number(d.vote_average||item.rating||0).toFixed(1)}</span>${d.runtime?`<span>${d.runtime} min</span>`:''}</div><p>${escText(d.overview||item.overview||'Sin descripción.')}</p><div class="actions"><button class="btn btn-primary" id="searchSources">▶ Buscar video</button><button class="btn btn-ghost" id="addSource">＋ Añadir fuente</button><button class="btn btn-ghost" id="favBtn">${isFavorite(normalized)?'♥ Guardado':'♡ Favorito'}</button>${trailer?'<button class="btn btn-ghost" id="trailerBtn">Tráiler</button>':''}</div></div></div></section><section class="section source-section"><div class="section-head"><div><h2>Opciones de reproducción</h2><p>No plataformas: aquí aparecen fuentes que BloqueTV puede intentar reproducir directamente.</p></div></div><div id="sourceArea" class="source-area"><div class="source-callout"><div class="source-radar">◎</div><div><strong>Pulsa “Buscar video”</strong><span>BloqueTV consultará sus fuentes conectadas y el catálogo multimedia libre.</span></div></div></div></section>${type==='tv'?`<section class="section"><div class="section-head"><div><h2>Episodios</h2><p>Selecciona temporada y episodio</p></div></div><div id="episodeArea"></div></section>`:''}`;
  $('#detailBack').onclick=goBack;$('#favBtn').onclick=()=>{toggleFavorite(normalized);renderDetail(item,d);};
  $('#addSource').onclick=()=>{const s=addCustom(type,item.id,title);if(s)showSources(type,item.id,title,date,null,null,[s]);};
  $('#searchSources').onclick=()=>showSources(type,item.id,title,date);
  if(trailer)$('#trailerBtn').onclick=()=>openPlayer([{id:'trailer',label:'Tráiler',type:'youtube',url:trailer.key,quality:'YouTube',provider:'YouTube',fullLength:false}],`${title} — Tráiler`);
  if(type==='tv')renderSeasonPicker(item.id,title,d.seasons||[],date);
  const detail=state.activeDetail;setTimeout(()=>{if(state.route==='detail'&&state.activeDetail===detail)showSources(type,item.id,title,date);},120);
}
async function showSources(type,id,title,date,season=null,episode=null,extra=[],episodeName='',autoPlay=false,episodeUrl='',episodePageUrl=''){
  const requestId=++state.sourceRequest;sourceController?.abort();sourceController=new AbortController();const sourceSignal=AbortSignal.any([state.viewController.signal,sourceController.signal]);
  const area=$('#sourceArea'); if(!area)return; area.innerHTML='<div class="source-loading"><span></span><div><strong>Buscando servidores del capítulo…</strong><small>El capítulo aparecerá una sola vez; los servidores se eligen dentro de BloqueTV Player.</small></div></div>';
  const custom=getCustom(type,id,season,episode);
  try{
    const p=new URLSearchParams({type,id:String(id),title,year:year(date)});if(Number.isFinite(season))p.set('season',season);if(Number.isFinite(episode))p.set('episode',episode);if(episodeName)p.set('episodeName',episodeName);if(episodeUrl)p.set('episodeUrl',episodeUrl);
    if(['donghualife','jkanime'].includes(type))p.set('episodePageUrl',episodePageUrl);
    const d=await api(`/api/playable-sources?${p}`,{signal:sourceSignal});if(!area.isConnected||requestId!==state.sourceRequest)return;
    const sources=playerSources([...extra,...custom,...d.sources].filter((s,i,a)=>a.findIndex(x=>x.url===s.url)===i));
    const playbackTitle=Number.isFinite(episode)?`${title}${Number.isFinite(season)?` · T${season}`:''} · Capítulo ${episode}`:title;
    if(sources.length){
      area.innerHTML=`<div class="source-list"><article class="source-option episode-ready"><div class="source-index">▶</div><div class="source-info"><strong>${escText(playbackTitle)}</strong><span>${sources.length} ${sources.length===1?'servidor disponible':'servidores disponibles'} · elige el servidor dentro del reproductor</span><small>${esc(sources.map(s=>displayText(s.provider||s.label,'Servidor')).filter((v,i,a)=>a.indexOf(v)===i).join(' · '))}</small></div><div class="source-actions"><button class="play-source" id="playEpisodeNow">▶ Ver capítulo</button></div></article></div>`;
      $('#playEpisodeNow',area).onclick=()=>openPlayer(sources,playbackTitle);
      if(autoPlay)openPlayer(sources,playbackTitle);
    }else{
      area.innerHTML=`<div class="no-sources"><div>◌</div><h3>No encontré servidores para este capítulo</h3><p>El capítulo permanece como una sola entrada. Puedes añadir una URL directa compatible para este episodio.</p><button class="btn btn-primary" id="emptyAddSource">＋ Añadir fuente directa</button></div>`;
    }
    $('#emptyAddSource',area)?.addEventListener('click',()=>{const s=addCustom(type,id,title,season,episode);if(s)showSources(type,id,title,date,season,episode,[s],episodeName,true,episodeUrl,episodePageUrl);});
  }catch(e){if(e.name==='AbortError'||!area.isConnected||requestId!==state.sourceRequest)return;area.innerHTML=`<div class="no-sources"><h3>No se pudo completar la búsqueda</h3><p>${escText(e.message)}</p></div>`;}
}
async function renderSeasonPicker(tvId,title,seasons,date){
  const target=$('#episodeArea');
  target.innerHTML='<div class="detail-loading">Buscando capítulos en la fuente…</div>';
  try{
    const source=await api(`/api/latanime-episodes?title=${encodeURIComponent(title)}`);
    const sourceEpisodes=source.episodes||[];
    if(sourceEpisodes.length){
      renderSourceEpisodeList(target,tvId,title,date,sourceEpisodes,source.anime);
      return;
    }
  }catch(e){if(e.name==='AbortError')return;}
  if(!target.isConnected)return;
  const valid=seasons.filter(s=>s.season_number>0);
  if(!valid.length){target.innerHTML='<div class="empty-state compact">No hay episodios disponibles.</div>';return;}
  target.innerHTML=`<div class="season-tabs">${valid.map((s,i)=>`<button data-season="${s.season_number}" class="${i?'':'active'}">T${s.season_number}</button>`).join('')}</div><div id="episodeList"></div>`;
  $$('[data-season]',target).forEach(b=>b.onclick=()=>{$$('[data-season]',target).forEach(x=>x.classList.toggle('active',x===b));loadSeason(tvId,title,Number(b.dataset.season),date);});
  loadSeason(tvId,title,valid[0].season_number,date);
}
function resolveAnimeVariantState(variantState,anime,title){
  const seasons=variantState?.seasons||[];
  const activeUrl=variantState?.activeUrl||anime?.url||'';
  let activeSeason=Number(variantState?.activeSeason)||animeSeasonNumber(anime?.title||title);
  let activeLanguage=variantState?.activeLanguage||animeLanguageInfo(anime?.title||title).key;
  let seasonNode=seasons.find(s=>Number(s.season)===activeSeason)||seasons.find(s=>s.languages?.some(v=>v.url===activeUrl))||seasons[0]||null;
  if(seasonNode){
    activeSeason=Number(seasonNode.season)||activeSeason;
    const byUrl=seasonNode.languages?.find(v=>v.url===activeUrl);
    const active=byUrl||seasonNode.languages?.find(v=>v.key===activeLanguage)||seasonNode.languages?.find(v=>v.key==='latino')||seasonNode.languages?.[0]||null;
    if(active){activeLanguage=active.key||activeLanguage;return {seasons,activeUrl:active.url||activeUrl,activeSeason,activeLanguage,seasonNode,activeVariant:active};}
  }
  return {seasons,activeUrl,activeSeason,activeLanguage,seasonNode,activeVariant:null};
}

function renderSourceEpisodeList(target,tvId,title,date,episodes,anime,mediaType='tv',season=null,variantState=null,listOptions={}){
  if(mediaType==='donghualife')episodes=filterDonghuaEpisodes(episodes,anime?.url,season);
  const unique=[...new Map(episodes.filter(ep=>Number.isFinite(Number(ep.episode_number))).map(ep=>[Number(ep.episode_number),ep])).values()].sort((a,b)=>a.episode_number-b.episode_number);
  const resolved=mediaType==='latanime'?resolveAnimeVariantState(variantState,anime,title):null;
  const activeSeason=mediaType==='latanime'?(resolved?.activeSeason||season||1):season;
  const languageLabel=resolved?.activeVariant?.label||animeLanguageInfo(anime?.title||'').label;
  const showSeasonLabel=mediaType==='latanime'&&((resolved?.seasons?.length||0)>1||activeSeason>1);
  const suffix=[showSeasonLabel?`Temporada ${activeSeason}`:'',mediaType==='latanime'?languageLabel:''].filter(Boolean).map(x=>escText(x)).join(' · ');
  target.innerHTML=`<div class="playlist-note"><strong>${listOptions.remoteSearch?`${unique.length} capítulos mostrados${listOptions.query?'':` de ${listOptions.total}`}`:`Lista completa · ${unique.length} capítulos`}${suffix?` · ${suffix}`:''}</strong><span>${mediaType==='latanime'?`BloqueTV organiza esta obra por temporada e idioma.`:`Fuente: ${escText(anime?.title||title)} · un capítulo = una entrada; los servidores se eligen dentro del reproductor.`}</span></div><div class="episode-list">${unique.map(ep=>`<article class="episode"><div class="ep-number">${ep.episode_number}</div>${ep.thumbnail?`<img src="${esc(ep.thumbnail)}" alt="">`:'<div class="ep-empty">▶</div>'}<div class="ep-copy"><strong>${escText(ep.name||`Capítulo ${ep.episode_number}`)}</strong><span>Abre el capítulo para elegir servidor o descargar.</span></div><button class="ep-play" data-source-episode="${ep.episode_number}" data-ep-name="${encodeURIComponent(ep.name||'')}" data-ep-url="${encodeURIComponent(ep.url||'')}">▶ Ver</button></article>`).join('')}</div>`;
  const variantContext=mediaType==='latanime'&&anime?.url?{tvId,title,date,animeUrl:anime.url,animeTitle:anime.title||title,season:activeSeason,variantState}:null;
  if(!listOptions.remoteSearch)enhanceEpisodes(target,{variantContext});
  $$('[data-source-episode]',target).forEach(b=>b.onclick=()=>{const ep=unique.find(ep=>Number(ep.episode_number)===Number(b.dataset.sourceEpisode));if(ep)showSources(mediaType,tvId,title,date,activeSeason,Number(ep.episode_number),[],ep.name||'',true,ep.url||'',anime?.url||'');});
}

function enhanceEpisodes(target,{variantContext=null}={}){
 const list=$('.episode-list',target);if(!list)return;const rows=$$('.episode',list);if(rows.length<8&&!variantContext)return;
 const toolbar=document.createElement('div');toolbar.className='episode-tools';
 const search=rows.length>=8?'<label>Encuentra un capítulo<input type="search" placeholder="Número o nombre del capítulo"></label>':'<div class="episode-tool-spacer"></div>';
 const variants=variantContext?'<div class="episode-variant-buttons"><div class="episode-language" hidden><button class="episode-language-button" type="button" aria-haspopup="menu" aria-expanded="false"><span>Idiomas</span><b aria-hidden="true">⌄</b></button><div class="episode-language-menu" role="menu" hidden></div></div><div class="episode-season" hidden><button class="episode-season-button" type="button" aria-haspopup="menu" aria-expanded="false"><span>Temporadas</span><b aria-hidden="true">⌄</b></button><div class="episode-season-menu" role="menu" hidden></div></div></div>':'';
 toolbar.innerHTML=`${search}${variants}<span class="episode-count"></span>`;list.before(toolbar);
 const count=$('.episode-count',toolbar);count.textContent=`${rows.length} capítulos`;
 const input=$('input',toolbar);if(input)input.oninput=e=>{const q=e.target.value.toLocaleLowerCase().trim();let visible=0;rows.forEach(row=>{row.hidden=!row.textContent.toLocaleLowerCase().includes(q);if(!row.hidden)visible++;});count.textContent=visible?`${visible} capítulos`:'No hay coincidencias';};
 if(variantContext)setupEpisodeVariantMenus(target,toolbar,variantContext);
}

async function setupEpisodeVariantMenus(target,toolbar,context){
  const languageWrap=$('.episode-language',toolbar);const languageButton=$('.episode-language-button',toolbar);const languageMenu=$('.episode-language-menu',toolbar);
  const seasonWrap=$('.episode-season',toolbar);const seasonButton=$('.episode-season-button',toolbar);const seasonMenu=$('.episode-season-menu',toolbar);
  if(!languageWrap||!languageButton||!languageMenu||!seasonWrap||!seasonButton||!seasonMenu)return;
  const closeAll=()=>{for(const [wrap,button,menu] of [[languageWrap,languageButton,languageMenu],[seasonWrap,seasonButton,seasonMenu]]){menu.hidden=true;button.setAttribute('aria-expanded','false');wrap.classList.remove('open');}};
  const toggle=(wrap,button,menu)=>{const opening=menu.hidden;closeAll();if(opening){menu.hidden=false;button.setAttribute('aria-expanded','true');wrap.classList.add('open');}};
  languageButton.onclick=e=>{e.stopPropagation();toggle(languageWrap,languageButton,languageMenu);};
  seasonButton.onclick=e=>{e.stopPropagation();toggle(seasonWrap,seasonButton,seasonMenu);};
  const outside=e=>{if(!toolbar.isConnected){document.removeEventListener('click',outside);document.removeEventListener('keydown',escape);return;}if(!toolbar.contains(e.target))closeAll();};
  const escape=e=>{if(e.key==='Escape'){closeAll();}};
  document.addEventListener('click',outside);document.addEventListener('keydown',escape);
  try{
    let state=context.variantState?.seasons?.length?context.variantState:null;
    if(!state){state=await api(`/api/latanime-work-variants?title=${encodeURIComponent(context.title)}&url=${encodeURIComponent(context.animeUrl||'')}`);}
    if(!toolbar.isConnected||!state?.seasons?.length)return;
    const currentUrl=context.variantState?.activeUrl||context.animeUrl||state.activeUrl;
    let activeSeason=Number(context.variantState?.activeSeason||state.activeSeason||context.season||1);
    let seasonNode=state.seasons.find(s=>s.languages?.some(v=>v.url===currentUrl))||state.seasons.find(s=>Number(s.season)===activeSeason)||state.seasons[0];
    activeSeason=Number(seasonNode?.season)||1;
    let activeVariant=seasonNode.languages?.find(v=>v.url===currentUrl)||seasonNode.languages?.find(v=>v.key===(context.variantState?.activeLanguage||state.activeLanguage))||seasonNode.languages?.find(v=>v.key==='latino')||seasonNode.languages?.[0];
    const activeLanguage=activeVariant?.key||context.variantState?.activeLanguage||state.activeLanguage||'disponible';
    languageWrap.hidden=false;seasonWrap.hidden=false;
    languageButton.title=activeVariant?.label?`Idioma actual: ${activeVariant.label}`:'Cambiar idioma';
    seasonButton.title=`Temporada actual: ${activeSeason}`;
    languageMenu.innerHTML=(seasonNode.languages||[]).map(v=>`<button type="button" role="menuitemradio" aria-checked="${v.url===activeVariant?.url?'true':'false'}" class="episode-language-option ${v.url===activeVariant?.url?'active':''}" data-language-url="${encodeURIComponent(v.url)}"><span>${escText(v.label||'Idioma')}</span>${Number(v.episodeCount)>0?`<small>${Number(v.episodeCount)} cap.</small>`:''}<b aria-hidden="true">${v.url===activeVariant?.url?'✓':''}</b></button>`).join('');
    seasonMenu.innerHTML=state.seasons.map(s=>`<button type="button" role="menuitemradio" aria-checked="${Number(s.season)===activeSeason?'true':'false'}" class="episode-season-option ${Number(s.season)===activeSeason?'active':''}" data-season-number="${Number(s.season)}"><span>${escText(s.label||`Temporada ${s.season}`)}</span>${Number(s.episodeCount)>0?`<small>${Number(s.episodeCount)} cap.</small>`:''}<b aria-hidden="true">${Number(s.season)===activeSeason?'✓':''}</b></button>`).join('');
    let switching=false;
    const switchVariant=async(variant,nextSeason,reason)=>{
      closeAll();if(switching||!variant?.url||variant.url===activeVariant?.url&&Number(nextSeason)===activeSeason)return;
      switching=true;invalidateEpisodeSources();
      const episodeButtons=$$('[data-source-episode]',target);episodeButtons.forEach(b=>b.disabled=true);
      for(const b of [languageButton,seasonButton]){b.disabled=true;b.classList.add('loading');}
      const loadingButton=reason==='season'?seasonButton:languageButton;const loadingSpan=$('span',loadingButton);if(loadingSpan)loadingSpan.textContent='Cargando…';
      try{
        const detail=await api(`/api/latanime-details?url=${encodeURIComponent(variant.url)}`);
        if(!target.isConnected||!toolbar.isConnected)return;
        const sourceArea=$('#sourceArea');if(sourceArea)sourceArea.innerHTML='<div class="source-callout"><div class="source-radar">◎</div><div><strong>Elige un capítulo</strong><span>Los servidores corresponden a la temporada y al idioma seleccionados.</span></div></div>';
        const nextState={workTitle:state.workTitle||context.title,seasons:state.seasons,activeSeason:Number(nextSeason)||1,activeLanguage:variant.key||'disponible',activeUrl:detail.url||variant.url};
        renderSourceEpisodeList(target,context.tvId,context.title,context.date,detail.episodes||[],{title:detail.title||context.title,url:detail.url||variant.url},'latanime',Number(nextSeason)||1,nextState);
      }catch(err){switching=false;episodeButtons.forEach(b=>b.disabled=false);if(err.name!=='AbortError')toast(`No se pudo cambiar de ${reason==='season'?'temporada':'idioma'}: ${err.message}`);for(const b of [languageButton,seasonButton]){b.disabled=false;b.classList.remove('loading');}if(loadingSpan)loadingSpan.textContent=reason==='season'?'Temporadas':'Idiomas';}
    };
    $$('[data-language-url]',languageMenu).forEach(option=>option.onclick=e=>{e.stopPropagation();const url=decodeURIComponent(option.dataset.languageUrl||'');const variant=seasonNode.languages.find(v=>v.url===url);switchVariant(variant,activeSeason,'language');});
    $$('[data-season-number]',seasonMenu).forEach(option=>option.onclick=e=>{e.stopPropagation();const number=Number(option.dataset.seasonNumber);const selected=state.seasons.find(s=>Number(s.season)===number);if(!selected)return;const variant=selected.languages.find(v=>v.key===activeLanguage)||selected.languages.find(v=>v.key==='latino')||selected.languages[0];switchVariant(variant,number,'season');});
  }catch(err){if(err.name!=='AbortError'&&toolbar.isConnected){languageWrap.hidden=true;seasonWrap.hidden=true;}}
}

async function loadSeason(tvId,title,season,date){
  const box=$('#episodeList');if(!box)return;const seasonRequest=`${Date.now()}-${Math.random()}`;box.dataset.request=seasonRequest;box.innerHTML='<div class="detail-loading">Cargando lista de capítulos…</div>';
  try{
    const meta=await api(`/api/season?tvId=${tvId}&season=${season}`);if(!box.isConnected||box.dataset.request!==seasonRequest)return;
    const unique=[...new Map((meta.episodes||[]).filter(ep=>Number.isFinite(Number(ep.episode_number))).map(ep=>[Number(ep.episode_number),ep])).values()].sort((a,b)=>a.episode_number-b.episode_number);
    if(!unique.length){box.innerHTML='<div class="empty-state compact">No se encontraron capítulos para esta temporada.</div>';return;}
    box.innerHTML=`<div class="playlist-note"><strong>${unique.length} capítulos</strong><span>Catálogo de respaldo. Los servidores se eligen después, dentro del reproductor.</span></div><div class="episode-list">${unique.map(ep=>`<article class="episode"><div class="ep-number">${ep.episode_number}</div>${ep.still_path?`<img src="${img(ep.still_path,'w300')}" alt="">`:'<div class="ep-empty">▶</div>'}<div class="ep-copy"><strong>${escText(ep.name||`Capítulo ${ep.episode_number}`)}</strong><span>${escText(ep.overview||'Pulsa para abrir el capítulo y elegir servidor.')}</span></div><button class="ep-play" data-episode="${ep.episode_number}" data-ep-name="${encodeURIComponent(ep.name||'')}">▶ Ver</button></article>`).join('')}</div>`;
    enhanceEpisodes(box);
    $$('[data-episode]',box).forEach(b=>b.onclick=()=>{const ep=Number(b.dataset.episode);showSources('tv',tvId,title,date,season,ep,[],decodeURIComponent(b.dataset.epName),true);});
  }catch(e){if(e.name==='AbortError'||!box.isConnected||box.dataset.request!==seasonRequest)return;box.innerHTML=`<div class="empty-state compact">${escText(e.message)}</div>`;}
}

function renderFavorites(){const items=collapseAnimeViews(state.favorites);content.innerHTML=`<div class="search-head"><div><span class="eyebrow">BIBLIOTECA</span><h1>Favoritos</h1></div></div>${items.length?`<div class="media-grid">${items.map(resultCard).join('')}</div>`:'<div class="empty-state"><h2>No tienes favoritos</h2></div>'}`;bindCards();}
function renderHistory(){content.innerHTML=`<div class="search-head"><div><span class="eyebrow">HISTORIAL</span><h1>Búsquedas</h1></div></div>${state.history.length?`<div class="history-list">${state.history.map(x=>`<button data-history="${esc(x.query)}"><strong>${esc(x.query)}</strong><small>${new Date(x.at).toLocaleString('es-DO')}</small></button>`).join('')}</div>`:'<div class="empty-state"><h2>Sin historial</h2></div>'}`;$$('[data-history]').forEach(b=>b.onclick=()=>performSearch(b.dataset.history,true));}
function renderDownloads(){downloads.render(content);}
function normalizeUrl(value){
  try{const text=String(value).trim();if(!text||(/^[a-z][a-z\d+.-]*:/i.test(text)&&!/^https?:/i.test(text)))return '';const u=new URL(/^https?:\/\//i.test(text)?text:`https://${text}`);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u.href:'';}catch{return '';}
}
function renderError(e){if(e.name==='AbortError')return;content.innerHTML=`<div class="empty-state"><h2>Algo salió mal</h2><p>${escText(e.message)}</p><button class="btn btn-primary" id="retryView">Reintentar</button><button class="btn btn-ghost" data-route="home">Inicio</button></div>`;bindCards();$('#retryView')?.addEventListener('click',()=>state.route==='detail'?openDetail(state.activeDetail,{restore:true}):state.route==='search'&&state.query?performSearch(state.query,false,{restore:true}):renderRoute());}
function renderRoute(){if(state.route==='home')return renderHome();if(state.route==='search')return renderSearch();if(state.route==='anime'||state.route==='donghua'||state.route==='series'||state.route==='movies')return renderHub(state.route);if(state.route==='favorites')return renderFavorites();if(state.route==='history')return renderHistory();if(state.route==='downloads')return renderDownloads();}

searchInput.addEventListener('input',()=>{clearTimeout(state.timer);const q=searchInput.value.trim();if(q.length<2){if(state.route==='search'){rememberScroll();beginView('search');state.query='';state.searchResults=[];commitNavigation(true);renderSearch();}return;}state.timer=setTimeout(()=>performSearch(q,false),550);});
$('#globalSearchForm').onsubmit=e=>{e.preventDefault();clearTimeout(state.timer);performSearch(searchInput.value,true);};
$$('[data-route]').forEach(e=>e.onclick=()=>setRoute(e.dataset.route));
$('#navBack').onclick=goBack;$('#navForward').onclick=()=>history.forward();
$('#menuToggle').onclick=()=>setMenu(!document.body.classList.contains('menu-open'));$('#bottomMenu').onclick=()=>setMenu(true);$('#menuClose').onclick=()=>{setMenu(false);$('#menuToggle').focus();};$('#menuBackdrop').onclick=()=>setMenu(false);
$('#backToTop').onclick=()=>window.scrollTo({top:0,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
let scrollSaveTimer;window.addEventListener('scroll',()=>{$('#backToTop').hidden=window.scrollY<650;clearTimeout(scrollSaveTimer);scrollSaveTimer=setTimeout(rememberScroll,180);},{passive:true});
window.addEventListener('offline',()=>{$('#connectionBanner').hidden=false;});window.addEventListener('online',()=>{$('#connectionBanner').hidden=true;checkHealth();});
async function checkHealth(){try{const h=await api('/api/health',{signal:AbortSignal.timeout(6000)});$('#apiDot').className='status-dot ok';$('#apiStatus').textContent=h.ok?'BloqueTV conectado':'Conectando';}catch{$('#apiDot').className='status-dot bad';$('#apiStatus').textContent='Sin conexión al servidor';}}
checkHealth();
if('serviceWorker'in navigator){navigator.serviceWorker.getRegistrations().then(rs=>rs.filter(r=>r.scope===new URL('/',location.href).href).forEach(r=>r.unregister())).catch(()=>{});}
function readLocation(){const [path,query='']=location.hash.slice(2).split('?');return {route:routes.includes(path)?path:'home',query:new URLSearchParams(query).get('q')||''};}
async function restoreNavigation(entry){
  state.parentRoute=entry.parentRoute||'home';state.query=entry.query||'';searchInput.value=state.query;
  let result;if(entry.route==='detail'&&entry.item)result=openDetail(entry.item,{restore:true});else if(entry.route==='search'&&state.query)result=performSearch(state.query,false,{restore:true});else return setRoute(entry.route,{restore:true,scroll:entry.scroll||0});
  const signal=state.viewController.signal;await result;if(!signal.aborted)window.scrollTo({top:entry.scroll||0,behavior:'instant'});
}
window.addEventListener('popstate',e=>{navigationIndex=e.state?.nexusIndex||0;restoreNavigation(e.state||readLocation());});
history.scrollRestoration='manual';
const initial=history.state?.route?history.state:readLocation();history.replaceState({...initial,nexusIndex:navigationIndex},'',initial.route==='home'?'#/home':location.hash||'#/home');restoreNavigation(initial);
// Keep keyboard focus inside the active player; native dialogs handle this themselves.
document.addEventListener('keydown',e=>{
 if(e.key!=='Tab'||document.querySelector('dialog[open]'))return;
 const root=document.body.classList.contains('menu-open')?$('#mainSidebar'):$('#playerModal.open');if(!root)return;
 const focusable=$$('button:not(:disabled),a[href],input,video[controls],iframe,[tabindex="0"]',root).filter(x=>x.getClientRects().length);
 const first=focusable[0],last=focusable.at(-1);if(!first)return;
 if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
});
