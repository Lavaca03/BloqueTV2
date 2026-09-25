import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createJkAnime,jkTitleUrl,jkEpisodeUrl,parseJkDirectory,parseJkSearch,parseJkDetail,parseJkEpisodes,parseJkSources,scriptJson} from '../lib/jkanime.mjs';
const base='https://jkanime.net',owner=base+'/naruto/';
const dir=(page=1,rows=[{url:owner,title:'Naruto',image:'https://cdn.example/naruto.jpg',estado:'Concluido',tipo:'Serie'}])=>`<script>var animes = ${JSON.stringify({current_page:page,data:rows,total:5006,last_page:167,per_page:30})};</script>`;
const detail=(url=owner,count=220)=>`<meta property="og:url" content="${url}"><meta name="csrf-token" content="public-test-token"><div class="anime__details__content"><div class="anime_pic pc"><img src="https://cdn.example/poster.jpg"></div><div class="anime_data"><ul><li><span>Episodios:</span> ${count}</li><li><span>Estado:</span> Concluido</li><li><span>Idiomas:</span> Japones</li><li><span>Generos:</span><a href="/genero/accion/">Accion</a></li></ul></div><div class="anime_info"><h3>Naruto</h3><p class="scroll">Una aventura de prueba.</p></div><div id="guardar-anime" data-anime="41"></div></div><aside><h3>Temporadas</h3><a href="/one-piece/212/">212</a></aside><script>var endpoint="/ajax/episodes/41/";</script>`;
const data=(page=1,numbers=[1,2,3])=>({current_page:page,last_page:14,total:220,per_page:16,data:numbers.map(number=>({number,id:number+100,title:'Naruto '+number}))});
const page=(text,url,status=200,headers={})=>({finalUrl:url,response:new Response(typeof text==='string'?text:JSON.stringify(text),{status,headers})});
const card=(title='Naruto',url=owner)=>`<div class="anime__item"><a href="${url}"><div class="anime__item__pic" data-setbg="https://cdn.example/poster.jpg"></div></a><div class="anime__item__text"><ul><li>Concluido</li><li class="anime">Serie</li></ul><h5><a href="${url}">${title}</a></h5></div></div>`;
const players=`<meta property="og:url" content="${owner}1/"><a class="servers btn-show" data-id="0">Desu</a><script>var video=[];video[0] = '<iframe src="${base}/jkplayer/um?t=public-test"></iframe>';var servers = ${JSON.stringify([{remote:Buffer.from('https://media.example/embed/video').toString('base64'),server:'VOE'},{remote:Buffer.from('javascript:alert(1)').toString('base64'),server:'Unknown'}])};</script><aside><iframe src="https://ad.example/"></iframe><a href="/one-piece/54/">54</a></aside>`;

test('catalog reaches the last page and retains full titles, formats and distinct IDs',()=>{
 const d=parseJkDirectory(dir(167,[{title:'Temporada 2: Nombre &amp; final',url:base+'/naruto-vs.-test/'},{title:'Otra obra',url:base+'/other/'},{title:'Foreign',url:'https://evil.example/show/'},{title:'Login',url:base+'/login/'}]),base,167);
 assert.equal(d.page,167);assert.equal(d.total,5006);assert.equal(d.pageCount,167);assert.equal(d.items.length,2);assert.equal(d.items[0].title,'Temporada 2: Nombre & final');assert.notEqual(d.items[0].id,d.items[1].id);
 assert.throws(()=>parseJkDirectory(dir(1),base,2),/página solicitada/);
});
test('scripts are read as JSON data without evaluating JavaScript',()=>{
 assert.equal(scriptJson('<script>var animes = {"title":"}] \\\"","data":[]};window.bad=true;</script>','animes').title,'}] "');
 assert.throws(()=>scriptJson('<script>var animes = {data:execute()};</script>','animes'),/formato/);
 assert.throws(()=>parseJkDirectory('<html>Challenge</html>',base),/catálogo/);
 assert.equal(scriptJson('<!-- <script>var animes={};</script> -->','animes'),null);
});
test('search cards are restricted to the main search results, preserving punctuation',()=>{
 const rows=parseJkSearch('<aside>'+card('Ad',base+'/ad/')+'</aside><div class="page_directorio">'+card('Naruto &amp; amigos')+card('Especial',base+'/naruto-vs.-konohamaru/')+card('Foreign','https://foreign.example/a/')+'</div>',base);
 assert.deepEqual(rows.map(x=>x.title),['Naruto & amigos','Especial']);assert.equal(rows[0].status,'Concluido');
 assert.deepEqual(parseJkSearch('<div class="page_directorio">Sin resultados</div>',base),[]);
 assert.throws(()=>parseJkSearch('<h1>Blocked</h1>',base),/búsqueda/);
});
test('detail uses the work heading and scoped metadata rather than related seasons',()=>{
 const d=parseJkDetail(detail(),owner);assert.equal(d.metadata.title,'Naruto');assert.equal(d.metadata.episodeCount,220);assert.equal(d.metadata.language,'Japones');assert.deepEqual(d.metadata.genres,['Accion']);assert.equal(d.animeId,'41');
 assert.throws(()=>parseJkDetail(detail(base+'/one-piece/'),owner),/no corresponde/);
 assert.throws(()=>parseJkDetail(detail().replace('episodes/41/','episodes/99/'),owner),/confirmar/);
});
test('valid high episode numbers remain, duplicates and foreign owners are rejected',()=>{
 const d=data(14,[209,212,212,220]);d.data.push({number:54,anime_id:99},{number:159,url:base+'/bleach/159/'},{number:'bad'});
 const result=parseJkEpisodes(d,{url:owner,animeId:'41'},14);
 assert.deepEqual(result.episodes.map(e=>e.episode_number),[209,212,220]);assert.equal(result.pageCount,14);assert.equal(result.total,220);
 assert.ok(result.episodes.every(e=>e.url.startsWith(owner)));
 assert.deepEqual(parseJkEpisodes([{number:211},{number:212}],{url:owner},1,'212').episodes.map(e=>e.episode_number),[212]);
 assert.throws(()=>parseJkEpisodes(d,{url:owner},1),/página/);
});
test('title and episode identities reject lookalikes, credentials and foreign hosts',()=>{
 for(const url of ['https://jkanime.net.evil.example/naruto/','https://x@y/naruto/',base+'/naruto/1/','javascript:alert(1)',base+'/ajax/'])assert.equal(jkTitleUrl(url,base),null);
 assert.equal(jkEpisodeUrl(base+'/naruto-shippuden/54/',owner,54),null);assert.equal(jkEpisodeUrl(owner+'54/',owner,159),null);assert.equal(jkEpisodeUrl(owner+'54?x=y',owner,54),owner+'54/');
});
test('player extraction only uses the selected episode player data',()=>{
 const sources=parseJkSources(players,owner+'1/');assert.deepEqual(sources.map(s=>s.label),['Desu','VOE']);assert.ok(sources.every(s=>s.pageUrl===owner+'1/'&&s.type==='embed'));assert.ok(sources.every(s=>!s.url.includes('ad.example')));
 assert.throws(()=>parseJkSources(players,base+'/bleach/1/'),/no corresponde/);
});
test('sessions use anonymous CSRF POST and return no cookies or token to the interface',async()=>{
 const calls=[];const service=createJkAnime({fetchRemote:async(url,options)=>{calls.push({url,options});return url===owner?page(detail(),url,200,{'set-cookie':'session=anonymous; Path=/; HttpOnly'}):page(data(),url);}});
 const d=await service.details(owner);assert.equal(d.title,'Naruto');assert.equal(d.episodePage.total,220);assert.equal(d.episodes.length,3);assert.doesNotMatch(JSON.stringify(d),/public-test-token|anonymous/);
 assert.equal(calls[1].options.method,'POST');assert.equal(calls[1].options.headers.cookie,'session=anonymous');assert.equal(calls[1].options.body,'_token=public-test-token');assert.equal(calls[1].options.redirectOrigin,base);
});
test('expired anonymous sessions are refreshed once without an unbounded retry',async()=>{
 let gets=0,posts=0;const service=createJkAnime({fetchRemote:async(url)=>{if(url===owner){gets++;return page(detail(),url);}posts++;return page(posts===1?'Expired':data(),url,posts===1?419:200);}});
 assert.equal((await service.episodes(owner)).episodes.length,3);assert.equal(gets,2);assert.equal(posts,2);
 const alwaysExpired=createJkAnime({fetchRemote:async url=>url===owner?page(detail(),url):page('Expired',url,419)});
 await assert.rejects(alwaysExpired.episodes(owner),/419/);
});
test('catalog caching deduplicates concurrent requests and evicts old pages',async()=>{
 let calls=0,time=0;const service=createJkAnime({maxEntries:2,ttl:10,now:()=>time,fetchRemote:async url=>{calls++;return page(dir(Number(new URL(url).searchParams.get('p'))),url);}});
 await Promise.all([service.catalog(1),service.catalog(1)]);assert.equal(calls,1);await service.catalog(2);await service.catalog(167);await service.catalog(1);assert.equal(calls,4);time=11;await service.catalog(1);assert.equal(calls,5);
});
test('search uses the native canonical search and keeps spaces encoded',async()=>{
 let seen;const service=createJkAnime({fetchRemote:async url=>{seen=url;return page('<div class="page_directorio">'+card()+'</div>',url);}});
 const found=await service.search('Naruto Shippuden');assert.equal(seen,base+'/buscar/Naruto%20Shippuden');assert.equal(found.items.length,1);
});
test('foreign redirect or canonical identity fails without replacing the work',async()=>{
 const service=createJkAnime({fetchRemote:async()=>page(detail(base+'/bleach/'),base+'/bleach/')});
 await assert.rejects(service.details(owner),/otro título/);
});
test('unavailable episodes retain the detail and an explicit retryable error',async()=>{
 const service=createJkAnime({fetchRemote:async url=>url===owner?page(detail(),url):page('Unavailable',url,503)});
 const d=await service.details(owner);assert.equal(d.title,'Naruto');assert.equal(d.episodeCount,220);assert.deepEqual(d.episodes,[]);assert.match(d.episodePage.error,/503/);
});
test('upcoming titles have an empty list without inventing links from the declared count',async()=>{
 const service=createJkAnime({fetchRemote:async url=>url===owner?page(detail(owner,12),url):page({...data(),data:[],total:0,last_page:1},url)});
 const d=await service.details(owner);assert.equal(d.episodeCount,0);assert.deepEqual(d.episodes,[]);
});
test('playback verifies availability in this title API before fetching a player',async()=>{
 const calls=[];const service=createJkAnime({fetchRemote:async url=>{calls.push(url);return page(url===owner?detail():url.includes('search_episode')?[{number:1}]:players,url);}});
 await assert.rejects(service.sources({episodePageUrl:owner,episodeUrl:base+'/bleach/54/',episode:54}),/no corresponde/);assert.equal(calls.length,0);
 await assert.rejects(service.sources({episodePageUrl:owner,episodeUrl:owner+'212/',episode:212}),/no está disponible/);assert.ok(!calls.includes(owner+'212/'));
 const sources=await service.sources({episodePageUrl:owner,episodeUrl:owner+'1/',episode:1});assert.equal(sources.length,2);assert.equal(calls.at(-1),owner+'1/');
});
test('disabled integration makes no network calls',async()=>{
 const service=createJkAnime({enabled:false,fetchRemote:()=>assert.fail('Network should stay idle')});
 await assert.rejects(service.catalog(),/desactivado/);await assert.rejects(service.search('Naruto'),/desactivado/);await assert.rejects(service.details(owner),/desactivado/);
 assert.deepEqual(await service.sources({episodePageUrl:owner,episodeUrl:owner+'1/',episode:1}),[]);
});
