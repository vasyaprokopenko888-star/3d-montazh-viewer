const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {webcrypto} = require('node:crypto');
const elements = new Map();
const $ = id => { if (!elements.has(id)) elements.set(id, {}); return elements.get(id); };
const env = {$,document:{getElementById:id=>$('#'+id)},Blob,URLSearchParams,crypto:webcrypto,TextEncoder,
 cloudSession:{user:{id:'member'}},cloudConfig:{url:'https://test.invalid',workspace:'board'}};
const source = fs.readFileSync(require('node:path').join(__dirname,'../planner-receipts.js'),'utf8');
vm.runInNewContext(source.replace(/\}\)\(\);\s*$/, `globalThis.test = {upload, assertContext, setup(fn) {context={url:'https://test.invalid',board:'board',user:'member'};request=fn;}};})();`),env);
const receipt = {id:'stable-id',date:'2026-11-13',photo:new Blob(['jpeg']),width:10,height:20};
(async()=>{
 let metadata = null, object = null, inserts = 0, uploads = 0, failMetadata = true;
 env.test.setup(async(path,options={})=>{
  if(path.startsWith('/rest/')) {
   if(options.method==='POST') {
    if(failMetadata) { failMetadata=false; throw Error('Network interrupted after image upload'); }
    metadata=JSON.parse(options.body); inserts++; return [metadata];
   }
   return metadata ? [metadata] : [];
  }
  if(options.method==='POST') {
   if(object) throw Object.assign(Error('Already exists'),{status:409});
   object=options.body; uploads++; return {};
  }
  return object;
 });
 await assert.rejects(env.test.upload(receipt),/Network interrupted/);
 assert.equal(uploads,1);
 await env.test.upload(receipt);
 assert.equal(inserts,1);
 assert.equal(uploads,1);
 await env.test.upload(receipt);
 assert.equal(inserts,1,'retry must not duplicate metadata');
 metadata.deleted_at='2026-11-13T12:00:00Z';
 await env.test.upload(receipt);
 assert.equal(inserts,1,'legacy import must not resurrect deleted records');
 metadata=null;
 await assert.rejects(env.test.upload({...receipt,photo:new Blob(['different'])}),/Конфлікт фото/);
 env.cloudConfig.workspace='other-board';
 assert.throws(()=>env.test.assertContext(),/Обліковий запис змінився/);
 console.log('PASS: interrupted upload retry, deduplication, tombstone preservation, image conflict, workspace switch');
})().catch(error=>{console.error(error);process.exitCode=1});
