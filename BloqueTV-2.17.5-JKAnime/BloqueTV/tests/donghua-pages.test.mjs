import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseDonghuaPage,createDonghuaDetailsReader,donghuaItemId} from '../lib/donghua-pages.mjs';
import {mediaTitle} from '../public/display-text.js';

const base='https://catalog.example';
const series=base+'/series/mad-demon-lord';
const season=base+'/season/mad-demon-lord-1';
const a=(url,label='Enlace')=>`<a href="${url}">${label}</a>`;
const ep=(owner,n)=>a(`/episode/${owner}-episodio-x${n}`,`Episodio ${n}`);
const page=(title,body,sidebar='')=>`<!doctype html><html><head><title>${title} | Donghualife 2.0</title></head><body><article class="node node--view-mode-full"><div class="node-page">${body}</div></article><aside class="region-aside">${sidebar}</aside></body></html>`;
const list=body=>`<div class="episodios"><div class="view view-id-episodios"><h1>Episodios</h1><div class="view-content"><table><tbody>${body}</tbody></table></div></div></div>`;
const seasons=body=>`<div class="temporada"><h1>Temporadas</h1><div class="view-id-temporadas">${body}</div></div>`;

test('section headings never replace the actual series title',()=>{
  const p=parseDonghuaPage(page('Mad Demon Lord',seasons(a('/season/mad-demon-lord-1'))),series);
  assert.equal(p.title,'Mad Demon Lord');
  assert.equal(mediaTitle('Temporadas','Mad Demon Lord'),'Mad Demon Lord');
  assert.equal(mediaTitle('Episodios','Otra serie'),'Otra serie');
});
test('the current title heading wins over generic metadata and unrelated headings',()=>{
  const html=page('Temporadas',`<h2><a rel="bookmark" href="${series}"><span class="field--name-title">King&#39;s &amp; Demon</span></a></h2><h1>Temporadas</h1>`).replace('<title>','<meta content="Episodios" property="og:title"><title>');
  assert.equal(parseDonghuaPage(html,series).title,"King's & Demon");
});
test('sidebar episodes 27 and 54 cannot enter the selected season',()=>{
  const own=Array.from({length:20},(_,i)=>`<div class="views-row"><tr><td>${ep('mad-demon-lord-1',i+1)}</td></tr></div>`).join('');
  const p=parseDonghuaPage(page('Mad Demon Lord - 1',list(own),ep('another-series-1',27)+ep('different-series-8',54)),season);
  assert.deepEqual(p.episodes.map(e=>e.episode_number),Array.from({length:20},(_,i)=>i+1));
  assert.ok(p.episodes.every(e=>e.url.startsWith(base+'/episode/mad-demon-lord-1-')));
});
test('ownership checks keep valid high episode numbers and reject foreign series and seasons',()=>{
  const html=page('Mad Demon Lord - 1',list(ep('other-series-1',1)+ep('mad-demon-lord-2',2)+ep('mad-demon-lord-1',1)+ep('mad-demon-lord-1',27)+ep('mad-demon-lord-1',54)));
  assert.deepEqual(parseDonghuaPage(html,season).episodes.map(e=>e.episode_number),[1,27,54]);
});
test('nested media articles and fake script links do not change list boundaries',()=>{
  const html=page('Mad Demon Lord - 1',`<article class="media"><img src="/cover.jpg"></article><script>const html='${ep('mad-demon-lord-1',99)}';</script><template>${list(ep('mad-demon-lord-1',98))}</template>${list(ep('mad-demon-lord-1',1))}`);
  assert.deepEqual(parseDonghuaPage(html,season).episodes.map(e=>e.episode_number),[1]);
});
test('only season links in the primary season list are followed',()=>{
  const html=page('Mad Demon Lord',seasons(a('/season/mad-demon-lord-1')+a('/season/mad-demon-lord-2'))+`<aside>${seasons(a('/season/foreign-4'))}</aside>`,seasons(a('/season/other-3')));
  assert.deepEqual(parseDonghuaPage(html,series).seasons.map(s=>s.url),[season,base+'/season/mad-demon-lord-2']);
});
test('pagination is limited to the same page inside the episode view',()=>{
  const html=page('Mad Demon Lord - 1',list(ep('mad-demon-lord-1',1)+`<nav class="pager">${a('?page=2','Última')+a('/season/other-1?page=20')}</nav>`)+a('?page=19'),a('?page=18'));
  assert.equal(parseDonghuaPage(html,season).maxPage,2);
});
test('the reader merges pages without mixing repeated episode numbers across seasons',async()=>{
  const pages=new Map([
    [series,page('Mad Demon Lord',seasons(a('/season/mad-demon-lord-2')+a('/season/mad-demon-lord-1')),a('/season/foreign-3'))],
    [season,page('Mad Demon Lord - 1',list(ep('mad-demon-lord-1',2)+a('?page=1')))],
    [season+'?page=1',page('Mad Demon Lord - 1',list(ep('mad-demon-lord-1',1)+ep('mad-demon-lord-1',2)))],
    [base+'/season/mad-demon-lord-2',page('Mad Demon Lord - 2',list(ep('mad-demon-lord-2',1)),ep('other-1',54))]
  ]);
  const calls=[];
  const reader=createDonghuaDetailsReader({baseUrl:base,fetchPage:async url=>{calls.push(url);assert.ok(pages.has(url),url);return {html:pages.get(url),finalUrl:url};}});
  const result=await reader.details(series);
  assert.equal(result.title,'Mad Demon Lord');assert.equal(result.episodeCount,3);
  assert.deepEqual(result.seasons.map(s=>[s.season_number,s.episodes.map(e=>e.episode_number)]),[[1,[1,2]],[2,[1]]]);
  assert.deepEqual(result.episodes,[]);assert.equal(calls.length,4);
});
test('a failed season cannot fall back to episodes promoted elsewhere',async()=>{
  const reader=createDonghuaDetailsReader({baseUrl:base,fetchPage:async url=>{
    if(url!==series)throw new Error('Temporarily unavailable');
    return {html:page('Mad Demon Lord',seasons(a('/season/mad-demon-lord-1')),ep('other-1',27)+ep('other-1',54)),finalUrl:url};
  }});
  const result=await reader.details(series);assert.equal(result.episodeCount,0);assert.deepEqual(result.seasons,[]);
});
test('direct episode lists retain season identity and unknown layouts stay empty',async()=>{
  const reader=createDonghuaDetailsReader({baseUrl:base,fetchPage:async url=>({html:page('Mad Demon Lord',list(ep('mad-demon-lord-1',1)+ep('mad-demon-lord-2',1))),finalUrl:url})});
  const result=await reader.details(series);assert.equal(result.episodeCount,2);assert.deepEqual(result.seasons.map(s=>s.season_number),[1,2]);
  assert.deepEqual(parseDonghuaPage(page('Mad Demon Lord',ep('mad-demon-lord-1',1)),series).episodes,[]);
});
test('redirected or mismatched canonical pages cannot replace the selected work',async()=>{
  const reader=createDonghuaDetailsReader({baseUrl:base,fetchPage:async()=>({html:page('Other',''),finalUrl:base+'/series/other'})});
  await assert.rejects(reader.details(series),/no corresponde/);
  assert.throws(()=>parseDonghuaPage(page('Other','').replace('<head>','<head><link rel="canonical" href="/series/other">'),series),/no corresponde/);
});
test('catalog IDs use the full title URL instead of the shared domain prefix',()=>{
  assert.notEqual(donghuaItemId(series,'series'),donghuaItemId(base+'/series/another-series','series'));
  assert.equal(donghuaItemId(series,'series'),donghuaItemId(series+'/?tracking=1#top','series'));
});

test('named specials keep their actual labels instead of inventing season numbers',()=>{
  const html=page('Mad Demon Lord',seasons(a('/season/mad-demon-lord-1')+`<div class="serie"><div class="especial">Especial</div><div class="imagen">${a('/season/the-origin','')}</div><div class="titulo">The Origin</div></div>`+a('/season/mad-demon-lord-2')));
  const refs=parseDonghuaPage(html,series).seasons;
  assert.deepEqual(refs.map(s=>s.season_number),[1,null,2]);
  assert.equal(refs[1].special,true);assert.equal(refs[1].title,'The Origin');
});

test('Más vistos is excluded even when nested inside a primary episode list',()=>{
  const promoted=ep('doupo-cangqiong-8',54)+ep('el-inmortal-renegado-1',159)+ep('lingwu-dalu-1',212);
  const widget=`<div class="view view-mas-vistos-hoy view-id-mas_vistos_hoy">${promoted}${ep('mad-demon-lord-1',212)}</div>`;
  const p=parseDonghuaPage(page('Mad Demon Lord',list(ep('mad-demon-lord-1',1)+widget)),season);
  assert.deepEqual(p.episodes.map(e=>e.episode_number),[1]);
});

test('a promoted season nested inside the primary list is not followed',async()=>{
  const calls=[];
  const reader=createDonghuaDetailsReader({baseUrl:base,fetchPage:async url=>{
    calls.push(url);
    return {finalUrl:url,html:url===series?page('Mad Demon Lord',seasons(a('/season/mad-demon-lord-1')+`<div class="view-mas-vistos-hoy">${a('/season/lingwu-dalu-1')}</div>`)):page('Mad Demon Lord - 1',list(ep('mad-demon-lord-1',1)))};
  }});
  const result=await reader.details(series);
  assert.deepEqual(calls,[series,season]);assert.equal(result.episodeCount,1);
});

test('a season alias explicitly linked in the main list keeps its actual episodes',async()=>{
  const reader=createDonghuaDetailsReader({baseUrl:base,fetchPage:async url=>({finalUrl:url,html:url===series?page('Mad Demon Lord',seasons(a('/season/translated-title-2'))):page('Translated Title - 2',list(ep('translated-title-2',1)+ep('lingwu-dalu-1',212)))})});
  const result=await reader.details(series);
  assert.equal(result.episodeCount,1);assert.equal(result.seasons[0].seriesUrl,series);assert.equal(result.seasons[0].season_number,2);
});

test('the reader preserves a named special with its series relationship',async()=>{
  const specialUrl=base+'/season/the-origin';
  const reader=createDonghuaDetailsReader({baseUrl:base,fetchPage:async url=>({finalUrl:url,html:url===series?page('Mad Demon Lord',seasons(`<div class="serie"><div class="especial">Especial</div><div class="titulo">The Origin</div>${a(specialUrl)}</div>`)):page('The Origin',list(ep('the-origin',1))+`<div class="view-mas-vistos-hoy">${ep('other-1',159)}</div>`)})});
  const result=await reader.details(series);
  assert.equal(result.episodeCount,1);assert.equal(result.seasons[0].seriesUrl,series);assert.equal(result.seasons[0].label,'The Origin');
});
