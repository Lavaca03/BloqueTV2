import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {fetchPublicWithRedirects,readTextLimited} from '../lib/remote.mjs';
function fixture(t,replies){
 const requests=[];
 t.mock.method(http,'request',(url,options,callback)=>{
  const request=new EventEmitter();request.setTimeout=()=>{};request.end=body=>{
   requests.push({url:url.href,...options,body});const reply=replies[requests.length-1];assert.ok(reply,'unexpected connection');
   queueMicrotask(()=>{const incoming=new PassThrough();incoming.statusCode=reply.status||200;incoming.headers=reply.headers||{};incoming.complete=true;callback(incoming);incoming.end(reply.body||'ok');});
  };return request;
 });return requests;
}
test('remote POST keeps its body and all Set-Cookie headers intact',async t=>{
 const calls=fixture(t,[{headers:{'set-cookie':['first=a; Path=/','second=b; Expires=Wed, 23 Sep 2037 00:00:00 GMT; Path=/']}}]);
 const {response}=await fetchPublicWithRedirects('http://8.8.8.8/ajax',{method:'POST',body:'_token=public',headers:{'Content-Type':'application/x-www-form-urlencoded'}});
 assert.equal(calls[0].method,'POST');assert.equal(calls[0].body,'_token=public');assert.equal(response.headers.getSetCookie().length,2);assert.equal(await readTextLimited(response),'ok');
 let pinned;calls[0].lookup('8.8.8.8',{},(_err,address)=>pinned=address);assert.equal(pinned,'8.8.8.8');
});
test('303 converts POST to GET and cross-origin redirects remove credentials',async t=>{
 const calls=fixture(t,[{status:303,headers:{location:'http://1.1.1.1/result'}},{}]);
 const {response}=await fetchPublicWithRedirects('http://8.8.8.8/ajax',{method:'POST',body:'token',headers:{Cookie:'anonymous=1',Authorization:'fixture','Content-Type':'text/plain'}});await response.text();
 assert.equal(calls[1].method,'GET');assert.equal(calls[1].body,undefined);assert.equal(calls[1].headers.cookie,undefined);assert.equal(calls[1].headers.authorization,undefined);assert.equal(calls[1].headers['content-type'],undefined);
});
test('307 keeps POST for a same-origin destination',async t=>{
 const calls=fixture(t,[{status:307,headers:{location:'/canonical'}},{}]);
 const {response}=await fetchPublicWithRedirects('http://8.8.8.8/ajax',{method:'POST',body:'token',headers:{Cookie:'anonymous=1'}});await response.text();
 assert.equal(calls[1].method,'POST');assert.equal(calls[1].body,'token');assert.equal(calls[1].headers.cookie,'anonymous=1');
});
test('a provider origin restriction blocks redirects before sending POST data',async t=>{
 const calls=fixture(t,[{status:307,headers:{location:'http://1.1.1.1/foreign'}}]);
 await assert.rejects(fetchPublicWithRedirects('http://8.8.8.8/ajax',{method:'POST',body:'token',redirectOrigin:'http://8.8.8.8'}),/otro sitio/);assert.equal(calls.length,1);
});
test('redirects to private networks remain blocked with POST enabled',async t=>{
 const calls=fixture(t,[{status:307,headers:{location:'http://127.0.0.1/private'}}]);
 await assert.rejects(fetchPublicWithRedirects('http://8.8.8.8/ajax',{method:'POST',body:'token'}),/servidor público/);assert.equal(calls.length,1);
});
