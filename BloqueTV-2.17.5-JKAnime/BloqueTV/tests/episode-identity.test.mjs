import {test} from 'node:test';
import assert from 'node:assert/strict';
import {filterDonghuaDetail, filterDonghuaEpisodes} from '../public/episode-identity.js';

const base='https://catalog.example';
const series=base+'/series/mad-demon-lord';
const season=base+'/season/mad-demon-lord-1';
const ep=(owner,n)=>({episode_number:n,name:`Capítulo ${n}`,url:`${base}/episode/${owner}-episodio-x${n}`});
const promoted=[ep('doupo-cangqiong-8',54),ep('el-inmortal-renegado-1',159),ep('lingwu-dalu-1',212)];

test('contaminated detail payloads exclude all three promoted chapters and repair every count',()=>{
  const own=Array.from({length:20},(_,i)=>ep('mad-demon-lord-1',i+1));
  const input={url:series,episodeCount:23,episodes:[...own,...promoted],seasons:[{url:season,season_number:1,episodes:[...own,...promoted]}]};
  const result=filterDonghuaDetail(input,series);
  assert.equal(result.episodeCount,20);assert.equal(result.episodes.length,20);
  assert.deepEqual(result.seasons[0].episodes.map(e=>e.episode_number),own.map(e=>e.episode_number));
  assert.equal(input.seasons[0].episodes.length,23,'do not mutate the response');
});

test('54, 159 and 212 remain available inside their actual series',()=>{
  for(const episode of promoted){
    const owner=new URL(episode.url).pathname.split('/').at(-1).split('-episodio-')[0];
    const seriesUrl=base+'/series/'+owner.replace(/-\d+$/,'');
    const result=filterDonghuaDetail({url:seriesUrl,seasons:[{url:base+'/season/'+owner,episodes:promoted}]},seriesUrl);
    assert.deepEqual(result.episodes.map(e=>e.url),[episode.url]);assert.equal(result.episodeCount,1);
  }
});

test('foreign episodes cannot overwrite a legitimate chapter with the same number',()=>{
  const own=ep('mad-demon-lord-1',1);
  assert.deepEqual(filterDonghuaEpisodes([ep('other-1',1),own,ep('other-1',1),own],season).map(e=>e.url),[own.url]);
});

test('chapter numbers must agree with their URLs and lookalike titles are different works',()=>{
  const input=[{...ep('mad-demon-lord-1',54),episode_number:2},ep('mad-demon-lord-extra-1',2),ep('mad-demon-lord-10',3),ep('mad-demon-lord-1',4),{episode_number:5}, {...ep('mad-demon-lord-1',6),url:'javascript:alert(1)'}];
  assert.deepEqual(filterDonghuaEpisodes(input,season).map(e=>e.episode_number),[4]);
});

test('legacy lists without a season URL are filtered against the selected series',()=>{
  const result=filterDonghuaDetail({seasons:[{season_number:1,episodes:[ep('mad-demon-lord-1',1),ep('mad-demon-lord-2',2),...promoted]}],episodeCount:5},series);
  assert.deepEqual(result.episodes.map(e=>e.episode_number),[1]);assert.equal(result.episodeCount,1);
});

test('a foreign season or a recommendation-only list cannot create a season tab',()=>{
  const result=filterDonghuaDetail({url:series,seasons:[{url:base+'/season/lingwu-dalu-1',episodes:promoted},{url:season,episodes:promoted}]},series);
  assert.deepEqual(result.seasons,[]);assert.deepEqual(result.episodes,[]);assert.equal(result.episodeCount,0);
});

test('named specials require the main series relationship and keep only their own episodes',()=>{
  const special={url:base+'/season/the-origin',special:true,season_number:null,label:'The Origin',seriesUrl:series,episodes:[ep('the-origin',1),...promoted]};
  const result=filterDonghuaDetail({url:series,seasons:[special]},series);
  assert.equal(result.seasons[0].label,'The Origin');assert.equal(result.episodeCount,1);
  assert.equal(filterDonghuaDetail({seasons:[{...special,seriesUrl:base+'/series/other'}]},series).episodeCount,0);
});

test('a different detail response cannot replace the selected series',()=>{
  assert.throws(()=>filterDonghuaDetail({url:base+'/series/other'},series),/no corresponde/);
  assert.throws(()=>filterDonghuaDetail({url:series},'invalid'),/no corresponde/);
});

test('normal URL variants retain identity and a different host does not',()=>{
  const own=ep('mad-demon-lord-1',1);
  assert.equal(filterDonghuaEpisodes([{...own,url:own.url+'/?tracking=1#top'}],season+'/').length,1);
  assert.equal(filterDonghuaEpisodes([{...own,url:own.url.replace('catalog.example','www.catalog.example')}],season).length,1);
  assert.equal(filterDonghuaEpisodes([{...own,url:own.url.replace('catalog.example','other.example')}],season).length,0);
});
