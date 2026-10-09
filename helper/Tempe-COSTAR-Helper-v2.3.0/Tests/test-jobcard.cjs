const assert = require('node:assert/strict');
const core = require('../Website/jobcard-shared.js');
const {createClient, pairing} = require('../Website/costar-client.js');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
let checks = 0;
function check(name, fn) { fn(); checks++; console.log('PASS ' + name); }
const clone = value => JSON.parse(JSON.stringify(value));
const validFields = {customerName:'TEST CUSTOMER',phone:'0400000000',rego:'ABC123',kilometres:'0',vehicle:'TEST VEHICLE',notes:''};
const add = (state, type, sku, replaceId) => core.reduce(state,{type:'add',jobId:state.jobId,productId:sku,product:{type,sku,description:'TEST '+type},replaceId});
let state = core.empty('draft-1');
state = core.reduce(state,{type:'patch',fields:validFields});
state = add(state,'tyre','TYRE-A');
check('tyre defaults to four and odometer zero is valid',()=>{ assert.equal(state.products[0].quantity,4); assert.deepEqual(core.validation(state),[]); });
state = add(state,'wheel','WHEEL-A');
state = add(state,'tyre','TYRE-B');
check('wheels sort before tyres while tyre order is retained',()=>assert.deepEqual(state.products.map(p=>p.sku),['WHEEL-A','TYRE-A','TYRE-B']));
check('wheel defaults to one',()=>assert.equal(state.products[0].quantity,1));
check('duplicate SKU across wheel/tyre types cannot change the card',()=>{
 const before=JSON.stringify(state);assert.throws(()=>add(state,'wheel','tyre-a'),/already/);assert.equal(JSON.stringify(state),before);
});
check('three-line limit requires an explicit replacement',()=>assert.throws(()=>add(state,'tyre','TYRE-C'),/occupied/));
state=core.reduce(state,{type:'quantity',productId:'TYRE-A',quantity:2});
state=add(state,'tyre','TYRE-C','TYRE-A');
check('replacement tyre resets quantity to four',()=>assert.equal(state.products.find(p=>p.sku==='TYRE-C').quantity,4));
check('a stale replacement selection cannot overwrite another product',()=>assert.throws(()=>add(state,'tyre','TYRE-D','TYRE-A'),/changed/));
check('placeholder, service and malformed SKUs are rejected',()=>{
 for(const code of ['JINA-N/A','SKU unavailable','WA','WAFR','M FB','DET','<script>','']) assert.equal(core.validSku(code),false,code);
});
check('quantity rejects zero, fractional and excessive values',()=>{
 for(const quantity of [0,1.5,101,NaN]) assert.throws(()=>core.reduce(state,{type:'quantity',productId:'TYRE-C',quantity}),/whole number/);
});
check('all five customer/vehicle fields and a product are mandatory',()=>{
 for(const key of ['customerName','phone','rego','kilometres','vehicle']) assert.ok(core.validation({...state,fields:{...state.fields,[key]:''}}).length,key);
 assert.ok(core.validation({...state,products:[]}).length);
});
check('enabled alignment requires a chosen code',()=>assert.ok(core.validation({...state,alignmentEnabled:true,alignment:''}).some(s=>s.includes('alignment'))));
state=core.reduce(state,{type:'alignment',enabled:true,code:'WAFR'});
state=core.reduce(state,{type:'patch',fields:{notes:'Customer parked in SF'}});
state=core.reduce(state,{type:'submit',revision:state.revision,submissionId:'MJC-test',createdUtc:'2026-09-29T00:00:00Z'});
const originalSnapshot=clone(state.submission.payload);
check('submission includes M FB, optional WAFR, vehicle/odo and notes without prices',()=>{
 assert.equal(originalSnapshot.fittingCode,'M FB');assert.equal(originalSnapshot.alignment,'WAFR');assert.equal(originalSnapshot.vehicle.odometer,0);
 assert.equal(originalSnapshot.additionalNotes,'Customer parked in SF');assert.deepEqual(originalSnapshot.products.map(p=>p.type),['wheel','tyre','tyre']);
 assert.ok(!JSON.stringify(originalSnapshot).includes('price'));assert.ok(!('totalCents' in originalSnapshot));
});
state=add(state,'tyre','AFTER-SUBMIT','TYRE-B');
state=core.reduce(state,{type:'patch',fields:{customerName:'CHANGED NAME',notes:'New local notes'}});
state=core.reduce(state,{type:'quantity',productId:'WHEEL-A',quantity:4});
check('later imports and edits never modify the submitted snapshot',()=>assert.deepEqual(state.submission.payload,originalSnapshot));
check('same draft cannot submit twice',()=>assert.throws(()=>core.reduce(state,{type:'submit',revision:state.revision,submissionId:'MJC-again'}),/already/));
check('New Job is blocked while pending',()=>assert.throws(()=>core.reduce(state,{type:'new',newJobId:'draft-2'}),/Ready for Review/));
check('a status for a different submission is rejected',()=>assert.throws(()=>core.reduce(state,{type:'status',status:{submissionId:'OTHER',status:'ready_for_review',version:10}}),/another submission/));
state=core.reduce(state,{type:'status',status:{submissionId:'MJC-test',status:'injecting',version:2,progress:'Adding tyres'}});
check('stale progress cannot move an active injection back to queued',()=>assert.equal(core.reduce(state,{type:'status',status:{submissionId:'MJC-test',status:'queued',version:1}}).submission.status,'injecting'));
state=core.reduce(state,{type:'status',status:{submissionId:'MJC-test',status:'ready_for_review',version:3}});
state=core.reduce(state,{type:'new',newJobId:'draft-2'});
check('New Job clears customer, all products including later imports, notes and alignment',()=>assert.deepEqual(state,core.empty('draft-2')));
check('old-tab edits cannot leak into the next customer',()=>assert.throws(()=>core.reduce(state,{type:'patch',jobId:'draft-1',fields:{customerName:'OLD CUSTOMER'}}),/new job/));
check('legacy autosave migration retains customer/vehicle and known SKU without treating tyre text as notes',()=>{
 const migrated=core.migrate({...validFields,tyre:'Old tyre description',tyreSku:'TYRE-OLD'},'migrated');
 assert.equal(migrated.products[0].sku,'TYRE-OLD');assert.equal(migrated.products[0].quantity,4);assert.equal(migrated.fields.notes,'');assert.equal(migrated.fields.rego,'ABC123');
});
check('legacy free text is retained for review but never submitted as a made-up SKU',()=>{
 const migrated=core.migrate({...validFields,tyre:'Unknown tyre'},'migrated');assert.equal(migrated.products.length,0);assert.equal(migrated.legacyTyreText,'Unknown tyre');assert.equal(migrated.fields.notes,'');
});
check('a changed card requires confirmation again',()=>{
 let s=add(core.reduce(core.empty('x'),{type:'patch',fields:validFields}),'tyre','TYRE-X');const revision=s.revision;
 s=core.reduce(s,{type:'quantity',productId:'TYRE-X',quantity:2});
 assert.throws(()=>core.reduce(s,{type:'submit',revision,submissionId:'MJC-stale'}),/changed/);
});
check('preview matches the requested product/service/detail/note order',()=>{
 let s=core.reduce(core.empty('x'),{type:'patch',fields:{...validFields,notes:'Parked in SF'}});s=add(add(s,'tyre','TYRE-X'),'wheel','WHEEL-X');s=core.reduce(s,{type:'alignment',enabled:true,code:'WA'});
 const text=core.preview(s), parts=['WHEEL: WHEEL-X','TYRE: TYRE-X','M FB','WA —','MAKE/MODEL','REGO NO','ODOMETER','M: Parked'];
 let last=-1;for(const part of parts){const at=text.indexOf(part);assert.ok(at>last,part);last=at;}
});
check('pairing requires local HTTPS and a valid key',()=>{
 assert.equal(pairing({baseUrl:'https://192.168.1.2:8787',token:'a'.repeat(32)}).baseUrl,'https://192.168.1.2:8787');
 for(const baseUrl of ['http://192.168.1.2:8787','https://example.com','https://user:pass@192.168.1.2','https://10.attacker.example','https://172.16.attacker.example']) assert.throws(()=>pairing({baseUrl,token:'a'.repeat(32)}));
});

// Execute the real UI and F Alt Tab integration against an in-memory DOM and receiver.
// Browser rendering, IndexedDB and Windows/RDP are intentionally not simulated as live tests.
class Node {
 constructor(tagName='DIV'){this.tagName=tagName;this.value='';this.textContent='';this.dataset={};this.children=[];this.disabled=false;this.hidden=false;this.checked=false;this.events={};this.classList={add(){},remove(){},contains(){return false;}};}
 addEventListener(name,fn){this.events[name]=fn;} setAttribute(){} append(...nodes){this.children.push(...nodes);} appendChild(n){this.children.push(n);return n;} replaceChildren(...nodes){this.children=nodes;} focus(){} setSelectionRange(){} remove(){} select(){}
}
const nodes=new Map();
const html=fs.readFileSync(path.join(__dirname,'../Website/Fitment_Planner.html'),'utf8');
for(const m of html.matchAll(/<([a-z]+)\b[^>]*\bid="([^"]+)"/g)) nodes.set(m[2],new Node(m[1].toUpperCase()));
const radios=['WA','WAFR'].map(value=>Object.assign(new Node('INPUT'),{value}));
const document={readyState:'loading',hidden:false,body:new Node('BODY'),head:new Node('HEAD'),events:{},getElementById:id=>nodes.get(id),createElement:tag=>new Node(tag.toUpperCase()),querySelectorAll:q=>q.includes('alignmentCode')?radios:[],querySelector:q=>q.includes(':checked')?radios.find(r=>r.checked):null,addEventListener(name,fn){this.events[name]=fn;}};
let draft=add(core.reduce(core.empty('ui-job'),{type:'patch',fields:validFields}),'tyre','UI-TYRE');
const memoryStore={read:async()=>clone(draft),mutate:async action=>{draft=core.reduce(draft,action);return clone(draft);},subscribe(){}};
let workerOnline=false, lostReply=false;
const requests=[],jobs=new Map();
const storage=new Map([['tempe:costar-pairing:v1',JSON.stringify({baseUrl:'https://192.168.1.2:8787',token:'a'.repeat(32)})]]);
const storageApi={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
const clientEnv={localStorage:storageApi,location:{hash:'',pathname:'/Fitment_Planner.html',search:''},history:{replaceState(){}},setTimeout,clearTimeout,
 fetch:async(url,options)=>{
  requests.push({url,options});const parsed=new URL(url),route=parsed.pathname,body=options.body?JSON.parse(options.body):null;
  let data;
  if(route.endsWith('/health'))data={service:'tempe-mobile-jobcard',apiVersion:1,workerConnected:workerOnline,receiving:true,pendingCount:jobs.size};
  else if(route.endsWith('/jobs')&&options.method==='POST'){
   if(!jobs.has(body.submissionId))jobs.set(body.submissionId,{payload:clone(body),status:{submissionId:body.submissionId,status:'queued',version:1}});
   data=jobs.get(body.submissionId).status;
   if(lostReply){lostReply=false;throw new Error('Connection lost after receipt');}
  }else if(route.includes('/jobs/'))data=jobs.get(decodeURIComponent(route.split('/jobs/')[1]))?.status;
  return {ok:!!data,status:data?200:404,json:async()=>clone(data)};
 }};
const context={console,document,localStorage:storageApi,navigator:{clipboard:{writeText:async()=>{}}},setTimeout:()=>0,clearTimeout(){},setInterval:()=>0,URL,URLSearchParams,Promise,Date,crypto:require('node:crypto').webcrypto,
 TempeJobCard:{...core,getStore:()=>memoryStore,toast(){},dialog:async()=>true},TempeCostarClient:createClient(clientEnv),location:{href:'https://test.invalid/index.html'},addEventListener(){}};
context.window=context;vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../Website/Fitment_Planner.js'),'utf8'),context);
(async()=>{
 await context.initJobCard();
 check('UI always displays all three product slots',()=>assert.equal(nodes.get('productLines').children.length,3));
 check('Submit stays disabled until the RDP worker is online',()=>assert.equal(nodes.get('submitBtn').disabled,true));
 workerOnline=true;await context.poll();
 check('connected receiver and worker enable Submit',()=>assert.equal(nodes.get('submitBtn').disabled,false));
 lostReply=true;await context.submit();
 const id=draft.submission.payload.submissionId;
 check('lost acknowledgement retains the fixed snapshot and exposes Retry',()=>{assert.equal(draft.submission.status,'awaiting_ack');assert.equal(nodes.get('retryBtn').hidden,false);assert.equal(nodes.get('newJobBtn').disabled,true);assert.equal(jobs.size,1);});
 draft=add(draft,'wheel','LATER-WHEEL');
 await context.refreshDraft();await context.retrySubmission();
 check('Retry reuses the exact accepted payload and cannot include later products',()=>{
  const posts=requests.filter(r=>r.options.method==='POST'&&r.url.endsWith('/jobs'));
  assert.equal(posts.length,2);assert.equal(posts[0].options.body,posts[1].options.body);assert.equal(jobs.size,1);assert.equal(jobs.get(id).payload.products.length,1);
 });
 await context.submit();
 check('second submit cannot send another order',()=>assert.equal(requests.filter(r=>r.options.method==='POST'&&r.url.endsWith('/jobs')).length,2));
 jobs.get(id).status={submissionId:id,status:'ready_for_review',version:2};await context.poll();
 check('Ready for Review enables New Job',()=>{assert.equal(nodes.get('newJobBtn').disabled,false);assert.equal(nodes.get('submissionStatus').textContent,'READY FOR REVIEW');});
 storage.set('fitment:selectedTyre','STALE TYRE');storage.set('fitment:mobile-jobcard:v3','STALE DRAFT');await context.newJob();
 check('New Job UI and legacy handoff are cleared',()=>{assert.equal(draft.products.length,0);assert.equal(nodes.get('customerName').value,'');assert.equal(storage.has('fitment:selectedTyre'),false);assert.equal(storage.has('fitment:mobile-jobcard:v3'),false);});
 draft=add(core.reduce(draft,{type:'patch',fields:validFields}),'tyre','RECONNECT-TYRE');await context.refreshDraft();
 const postsBefore=requests.filter(r=>r.options.method==='POST').length;
 workerOnline=false;await context.poll();workerOnline=true;await context.poll();
 check('reconnection enables the button but never submits an unfinished draft',()=>assert.equal(requests.filter(r=>r.options.method==='POST').length,postsBefore));
 lostReply=true;await context.submit();const postsAfter=requests.filter(r=>r.options.method==='POST').length;
 await context.poll();
 check('status polling recovers a lost acknowledgement without posting again',()=>{assert.equal(draft.submission.status,'queued');assert.equal(requests.filter(r=>r.options.method==='POST').length,postsAfter);});
 let selected=null;
 context.TempeJobCard.addProduct=async p=>{selected=p;return p;};
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../Website/F_alt_tab.js'),'utf8'),context);
 await context.selectTyreForFitment({sku:'T-TEST',make:'TEST',model:'TYRE',price:500});
 check('real F Alt Tab handoff passes tyre identity only and stays on the search page',()=>{assert.equal(selected.type,'tyre');assert.equal(selected.sku,'T-TEST');assert.equal(selected.price,undefined);assert.equal(context.location.href,'https://test.invalid/index.html');});
 let extensionCalls=0,pcCalls=0;
 context.fetchViaExtension=async()=>{extensionCalls++;return {text:'<div class="product-container">TEST</div>'};};
 context.TempeCostarClient={isPaired:()=>false,fetchTyres:async()=>{pcCalls++;return {text:'<div class="product-container">TEST</div>'};}};
 await context.fetchTextWithFallback('https://www.tempetyres.com.au/tyres?TyreWidth=225');
 check('unpaired desktop searches keep the existing extension transport',()=>{assert.equal(extensionCalls,1);assert.equal(pcCalls,0);});
 context.TempeCostarClient.isPaired=()=>true;
 await context.fetchTextWithFallback('https://www.tempetyres.com.au/tyres?TyreWidth=225');
 check('paired phone searches use the PC transport without requiring the Chrome extension',()=>{assert.equal(extensionCalls,1);assert.equal(pcCalls,1);});
 const realClient=createClient(clientEnv);let invalidRejected=false;
 try{await realClient.fetchTyres('https://unrelated.example/private');}catch(_){invalidRejected=true;}
 check('tyre transport refuses unrelated sites',()=>assert.ok(invalidRejected));
 check('receiver requests use an Authorization header and never put the key in URLs',()=>{for(const r of requests){assert.ok(r.options.headers.Authorization);assert.ok(!r.url.includes('a'.repeat(32)));assert.equal(r.options.redirect,'error');}});
 console.log(`${checks} checks passed. DOM/receiver adapters were used; no live browser, Windows or COSTAR was exercised.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
