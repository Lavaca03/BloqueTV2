import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
let server,base;
before(async()=>{
 server=spawn(process.execPath,['server.mjs'],{cwd:fileURLToPath(new URL('..',import.meta.url)),env:{...process.env,PORT:'0',LATANIME_ENABLED:'false',MUNDODONGHUA_ENABLED:'false',DONGHUALIFE_ENABLED:'false',JKANIME_ENABLED:'false'},stdio:['ignore','pipe','pipe']});
 const [output]=await once(server.stdout,'data');base=String(output).match(/http:\/\/localhost:\d+/)[0];
});
after(()=>server?.kill());
test('application starts, keeps TMDb off and serves all first-party assets',async()=>{
 const health=await fetch(base+'/api/health');assert.equal(health.status,200);const h=await health.json();assert.equal(h.version,'2.17.5-jkanime-1');assert.equal(h.tmdbConfigured,false);
 const response=await fetch(base+'/');const html=await response.text();assert.equal(response.status,200);assert.match(response.headers.get('content-security-policy'),/default-src 'self'/);
 for(const match of html.matchAll(/(?:src|href)="(\/(?!#)[^"]+)"/g)) {const asset=await fetch(base+match[1]);assert.equal(asset.status,200,match[1]);await asset.arrayBuffer();}
 const identity=await fetch(base+'/episode-identity.js');assert.equal(identity.status,200);assert.match(await identity.text(),/export function filterDonghuaDetail/);
});

test('playback API rejects foreign episodes 54, 159 and 212 before resolving servers',async()=>{
 for(const [owner,number] of [['doupo-cangqiong-8',54],['el-inmortal-renegado-1',159],['lingwu-dalu-1',212]]){
  const query=new URLSearchParams({type:'donghualife',id:'test',title:'Mad Demon Lord',season:'1',episode:String(number),episodeUrl:`https://donghualife.com/episode/${owner}-episodio-x${number}`,episodePageUrl:'https://donghualife.com/season/mad-demon-lord-1'});
  const response=await fetch(base+'/api/playable-sources?'+query);assert.equal(response.status,400);assert.match((await response.json()).error,/no corresponde/);
  query.set('episodePageUrl',`https://donghualife.com/season/${owner}`);
  const own=await fetch(base+'/api/playable-sources?'+query);assert.equal(own.status,200);assert.deepEqual((await own.json()).sources,[]);
 }
});
test('disabled providers yield a usable empty home without calling TMDb',async()=>{
 const r=await fetch(base+'/api/home');assert.equal(r.status,200);const home=await r.json();assert.equal(home.mode,'sources');assert.deepEqual(home.genres,[]);
});
test('malformed URLs, missing assets, methods and private targets have explicit errors',async()=>{
 for(const [path,status] of [['/%FF',400],['/missing.js',404],['/api/download-info?url=http://127.0.0.1/',400],['/api/analyze-url?url=http://169.254.169.254/',400]]) {const r=await fetch(base+path);assert.equal(r.status,status,path);await r.text();}
 const r=await fetch(base+'/api/health',{method:'POST'});assert.equal(r.status,405);await r.text();
});

test('JKAnime routes honor disabled mode and reject episodes from another anime',async()=>{
 for(const path of ['/api/jkanime-catalog','/api/jkanime-search?q=naruto','/api/jkanime-details?url=https://jkanime.net/naruto/','/api/jkanime-episodes?url=https://jkanime.net/naruto/']){
  const r=await fetch(base+path);assert.equal(r.status,503);await r.text();
 }
 const hub=await (await fetch(base+'/api/hub?kind=anime')).json();assert.equal(hub.catalog.total,0);
 for(const number of [54,159,212]){
  const q=new URLSearchParams({type:'jkanime',id:'fixture',title:'Naruto',episode:String(number),episodePageUrl:'https://jkanime.net/naruto/',episodeUrl:`https://jkanime.net/one-piece/${number}/`});
  const r=await fetch(base+'/api/playable-sources?'+q);assert.equal(r.status,400);assert.match((await r.json()).error,/no corresponde/);
 }
});
