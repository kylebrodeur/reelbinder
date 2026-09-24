import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire, registerHooks, stripTypeScriptTypes } from "node:module";
import { test } from "node:test";

const memory = new Map();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => memory.set(key, value),
    removeItem: (key) => memory.delete(key),
  },
});
const require = createRequire(import.meta.url);
const external = Object.fromEntries(["clsx", "tailwind-merge"].map((name) => [name, require.resolve(name)]));
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) specifier = new URL(`../src/${specifier.slice(2)}`, import.meta.url).href;
    if (specifier === "jszip") specifier = "jszip/dist/jszip.min.js";
    if (external[specifier]) specifier = external[specifier];
    if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) specifier += ".ts";
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith("?raw")) return { format: "module", shortCircuit: true, source: `export default ${JSON.stringify(readFileSync(new URL(url.slice(0, -4)), "utf8"))}` };
    if (!url.endsWith(".ts")) return nextLoad(url, context);
    return { format: "module", shortCircuit: true, source: stripTypeScriptTypes(readFileSync(new URL(url), "utf8")) };
  },
});
const { emptyShot, emptyFloor, emptyWorld } = await import("../src/lib/types.ts");
const { useSlate } = await import("../src/lib/store.ts");
const { validateSnapshotProject } = await import("../src/lib/slate-snapshot.ts");
const { packSlate, unpackSlate } = await import("../src/lib/slate-pack.ts");
const { toLiningJsonl } = await import("../src/lib/slate-md.ts");
const { applyLiningSidecar } = await import("../src/lib/lining-sidecar.ts");
const { previewProductionMerge, applyProductionMerge } = await import("../src/lib/production-catalog.ts");
const floorLib = await import("../src/lib/floor.ts");
let stageLib = {}; try { stageLib = await import("../src/lib/stage-format.ts"); } catch {}
hooks.deregister();
const ts=require('typescript');
function callback(file,attribute,index=0){
 const source=ts.createSourceFile(file,readFileSync(process.env.APP23_CALLBACK_BASE && attribute!=='targetLocked' ? `${process.env.APP23_CALLBACK_BASE}/src/components/app/${file}` : new URL(`../src/components/app/${file}`,import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);const found=[];
 function visit(n){if(ts.isJsxAttribute(n)&&n.name.getText(source)===attribute&&n.initializer?.expression)found.push(n.initializer.expression);if(ts.isVariableDeclaration(n)&&n.name.getText(source)===attribute)found.push(n.initializer);ts.forEachChild(n,visit);}visit(source);assert.ok(found[index]);
 return ts.transpileModule(`const handler=${found[index].getText(source)};`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
}
function fixture(){return {id:'film',name:'Stage',logline:'',style:'',target:'veo',updatedAt:1,world:emptyWorld(),floor:emptyFloor(),characters:[],skills:[],chain:[],binder:[],cutUrl:null,marks:[],breakdown:[{id:'source',department:'Set Dressing',tag:'dressing',item:'Lamp'},{id:'target',department:'Set Dressing',tag:'dressing',item:'Other lamp'}],script:[{id:'scene',kind:'scene',text:'INT. ROOM - DAY'},{id:'a',kind:'action',text:'A lamp.'}],shots:[emptyShot({id:'shot',setup:'D2',sceneId:'scene',elementIds:['a']})],timeline:{initialized:true,clips:[]}};}
function run(file,name,scope,index=0){return new Function(...Object.keys(scope),callback(file,name,index)+';return handler')(...Object.values(scope));}
function setup(p=fixture()){
 useSlate.setState({project:p,selectedId:p.shots[0]?.id ?? null}); const messages=[];let captures=0;
 const scope={...floorLib,...stageLib,useSlate,live:{current:{projectId:p.id,shot:p.shots[0] ?? null,categoryLocked:new Set()}},setBlocking:useSlate.getState().setBlocking,project:p,shot:p.shots[0],floor:p.floor,figures:[],editable:true,playing:false,categoryLocked:new Set(),capture:()=>captures++,patchFloor:useSlate.getState().patchFloor,writeFigures:figures=>useSlate.getState().setBlocking('shot',{figures}),select:()=>{},pointerToPlan:()=>({x:.2,y:.3}),uid:()=> 'placed',toast:{error:m=>messages.push(m)},setDropError:m=>messages.push(m)};
 return {scope,messages,get captures(){return captures;},drop:raw=>run('overhead-plan.tsx','onDrop',scope)({preventDefault(){},dataTransfer:{getData:()=>raw},currentTarget:{}})};
}
test('both real catalog drag callbacks create a valid snapshot and ZIP through actual drop/store',async()=>{
 for(let i=0;i<2;i++)for(const tag of ['dressing','equipment']){
 const p=fixture();p.breakdown[0].tag=tag;const ctx=setup(p);let raw;
 run('production-item-editor.tsx','onDragStart',{...stageLib,project:p,item:p.breakdown[0]},i)({dataTransfer:{setData:(_,v)=>raw=v}});
 ctx.drop(raw);const placed=useSlate.getState().project;assert.equal(placed.floor.items.length,1,JSON.stringify(ctx.messages));assert.equal(placed.floor.items[0].productionItemId,'source');validateSnapshotProject(placed);
 const restored=await unpackSlate(await (await packSlate(placed)).arrayBuffer());assert.deepEqual(restored.floor.items,placed.floor.items);
 }
});
test('catalog drops clamp full item geometry inside the Stage plan and report the correction',()=>{
 const p=fixture();
 const result=stageLib.prepareStageDrop(p,p.id,'shot',JSON.stringify({type:'prop',projectId:p.id,kind:'bar',label:'Bar',productionItemId:'source'}),{x:1,y:1},'bar-edge');
 const item=result.items.at(-1);
 assert.equal(result.clamped,true);
 assert.deepEqual({x:item.x,y:item.y},{x:.88,y:.64});
 assert.equal(floorLib.floorItemFitsPlan(item),true);
});
test('catalog merge repairs placed links in same Project update and retains IDs',()=>{
 const p=fixture();p.floor.items=[{id:'placed',kind:'rect',x:0,y:0,w:.1,h:.1,rotation:0,label:'Lamp',productionItemId:'source'}];
 const merged=applyProductionMerge(p,previewProductionMerge(p,'target',['source']));assert.equal(merged.floor.items[0].productionItemId,'target');assert.equal(merged.floor.items[0].id,'placed');
});
test('drop rejects stale Project, malformed payload and missing links before any capture/write',()=>{
 for(const update of [{projectId:'other'},{productionItemId:'missing'},{kind:'dressing'},{markId:'missing'},{productionItemId:null},{label:4}]){
 const ctx=setup();const before=structuredClone(useSlate.getState().project);
 ctx.drop(JSON.stringify({type:'prop',projectId:'film',kind:'rect',label:'Lamp',productionItemId:'source',...update}));
 assert.deepEqual(useSlate.getState().project,before);assert.equal(ctx.captures,0);assert.ok(ctx.messages.length);
 }
 const ctx=setup();const replacement={...fixture(),id:'other'};useSlate.setState({project:replacement});ctx.drop(JSON.stringify({type:'prop',projectId:'film',kind:'rect',label:'Lamp',productionItemId:'source'}));assert.deepEqual(useSlate.getState().project,replacement);assert.equal(ctx.captures,0);
});
test('actual catalog merge/store/sidecar/snapshot/ZIP keeps placed identity and occurrence link',async()=>{
 const p=fixture();p.marks=[{id:'mark',tag:'dressing',text:'lamp',note:'',elementId:'a',sceneId:'scene',start:2,end:6,productionItemId:'source'}];
 p.floor.items=[{id:'placed',kind:'rect',x:0,y:0,w:.1,h:.1,rotation:0,label:'Lamp',productionItemId:'source',markId:'mark',locked:true}];
 useSlate.getState().replaceProject(p);const current=useSlate.getState().project;const review=previewProductionMerge(current,'target',['source']);useSlate.getState().mergeProductionItems(review,{});
 const merged=useSlate.getState().project;assert.equal(merged.floor.items[0].productionItemId,'target');assert.equal(merged.marks[0].productionItemId,'target');assert.equal(merged.floor.items[0].markId,'mark');
 const sidecar=applyLiningSidecar(merged,toLiningJsonl(merged));assert.deepEqual(sidecar.floor,merged.floor);
 const restored=await unpackSlate(await (await packSlate(sidecar)).arrayBuffer());assert.deepEqual(restored.floor,merged.floor);
 const unlinked=stageLib.linkFloorMark(restored,restored.floor.items[0],null);assert.equal(unlinked.productionItemId,'target');assert.equal(unlinked.markId,undefined);
});
test('unresolved imported links survive snapshot/JSONL/ZIP with repair diagnostics; new invalid links reject',async()=>{
 const p=fixture();p.floor.items=[{id:'placed',kind:'rect',x:0,y:0,w:.1,h:.1,rotation:0,label:'Lamp',productionItemId:'missing',markId:'missing-mark'}];
 assert.equal(stageLib.floorLinkDiagnostics(p,p.floor.items[0]).length,2);validateSnapshotProject(p);
 assert.deepEqual(applyLiningSidecar(p,toLiningJsonl(p)).floor,p.floor);
 assert.deepEqual((await unpackSlate(await (await packSlate(p)).arrayBuffer())).floor,p.floor);
 assert.throws(()=>applyLiningSidecar(fixture(),JSON.stringify({kind:'floor',items:p.floor.items})),/unresolved/);
});
for(const lock of ['individual','category'])for(const operation of ['eraseTarget','onRotate','move'])test(`real ${operation} callback respects ${lock} lock`,()=>{
 const p=fixture();p.floor.items=[{id:'placed',kind:'chair',x:0,y:0,w:.1,h:.1,rotation:0,label:'Chair',...(lock==='individual'?{locked:true}:{})}];
 const ctx=setup(p),sel={kind:'item',id:'placed'};const categoryLocked=new Set(lock==='category'?['furniture']:[]);
 const live={current:{projectId:p.id,floor:p.floor,figures:[],shot:p.shots[0],categoryLocked}};
 Object.assign(ctx.scope,{sel,live,categoryLocked,STRUCTURAL_KINDS:floorLib.STRUCTURAL_KINDS,writeFigures:()=>{},snapAngle:floorLib.snapAngle,drag:{kind:'item',id:'placed',mode:'rotate'},svgRef:{current:{}},dragOrigin:{current:{x:0,y:0,captured:true}},setRotatingAngle:()=>{}});
 ctx.scope.targetLocked=run('overhead-plan.tsx','targetLocked',ctx.scope);
 ctx.scope.isItemLocked=item=>stageLib.stageItemLocked(p,item,categoryLocked);
 const before=structuredClone(p);run('overhead-plan.tsx',operation,ctx.scope,operation==='onRotate'?4:0)(operation==='eraseTarget'?sel:operation==='move'?{clientX:20,clientY:20}:90);
 assert.deepEqual(useSlate.getState().project,before);assert.equal(ctx.captures,0);
});
test('real unlink occurrence callback retains direct catalog identity',()=>{
 const p=fixture();p.floor.items=[{id:'placed',kind:'rect',x:0,y:0,w:.1,h:.1,rotation:0,label:'Lamp',productionItemId:'source',markId:'mark'}];
 const ctx=setup(p);Object.assign(ctx.scope,{sel:{kind:'item',id:'placed'},targetLocked:()=>false,sceneMarks:[]});run('overhead-plan.tsx','onLinkMark',ctx.scope)(null);
 assert.equal(useSlate.getState().project.floor.items[0].productionItemId,'source');assert.equal(useSlate.getState().project.floor.items[0].markId,undefined);
});
test('optional composition layers and floor lock/link shapes validate without discarding imported metadata',()=>{
 const p=fixture();p.shots[0].frameHistory=[{id:'f',url:'data:image/png;base64,YQ==',kind:'still',createdAt:1,composition:{layers:{guides:true,wireframe:false,markup:true,image:true,onionSkinOpacity:.4}}}];
 assert.deepEqual(validateSnapshotProject(p),p);p.shots[0].frameHistory[0].composition.layers.onionSkinOpacity=2;assert.throws(()=>validateSnapshotProject(p),/onionSkinOpacity/);
 p.shots[0].frameHistory=[];p.floor.items=[{id:'placed',kind:'rect',x:0,y:0,w:.1,h:.1,rotation:0,label:'Lamp',locked:'yes'}];assert.throws(()=>validateSnapshotProject(p),/locked/);
});
test('mark-only sidecar cannot introduce a contradictory placed catalog link',()=>{
 const p=fixture();p.marks=[{id:'mark',tag:'dressing',text:'lamp',note:'',elementId:'a',sceneId:'scene',start:2,end:6,productionItemId:'source'}];p.floor.items=[{id:'placed',kind:'rect',x:0,y:0,w:.1,h:.1,rotation:0,label:'Lamp',productionItemId:'source',markId:'mark'}];
 const before=structuredClone(p);assert.throws(()=>applyLiningSidecar(p,JSON.stringify({kind:'mark',id:'mark',productionItemId:'target'})),/different items/);assert.deepEqual(p,before);
});
test('cast drop moves unique existing same-character figure without replacing its historical ID',()=>{
 const p=fixture();p.characters=[{name:'Bounty Hunter',look:'Long coat'}];p.shots[0].blocking.figures=[{id:'bh',name:'Bounty Hunter',x:.1,y:.1,facing:90}];
 const payload=JSON.stringify({type:'cast',projectId:p.id,id:'bounty-hunter',name:'Bounty Hunter'});
 const result=stageLib.prepareStageDrop(p,p.id,'shot',payload,{x:.3,y:.4},'unused');assert.equal(result.figures.length,1);assert.equal(result.figures[0].id,'bh');assert.equal(result.id,'bh');
 p.shots[0].blocking.figures.push({id:'duplicate',name:'Bounty Hunter',x:.2,y:.2,facing:90});assert.throws(()=>stageLib.prepareStageDrop(p,p.id,'shot',payload,{x:.3,y:.4},'unused'),/ambiguous|multiple/i);
});
test('keyboard Delete routes through the category lock guard; unlocking restores rotation',()=>{
 const p=fixture();p.floor.items=[{id:'placed',kind:'chair',x:0,y:0,w:.1,h:.1,rotation:0,label:'Chair',locked:true}];
 let ctx=setup(p);const sel={kind:'item',id:'placed'},locked=new Set(['furniture']);const live={current:{projectId:p.id,floor:p.floor,figures:[],shot:p.shots[0],categoryLocked:locked,sel}};
 Object.assign(ctx.scope,{sel,live,categoryLocked:locked,rootRef:{current:{contains:()=>true}},setPlace:()=>{},setTool:()=>{},setDrag:()=>{}});ctx.scope.targetLocked=run('overhead-plan.tsx','targetLocked',ctx.scope);ctx.scope.eraseTarget=run('overhead-plan.tsx','eraseTarget',ctx.scope);
 run('overhead-plan.tsx','onKey',ctx.scope)({key:'Delete',target:{closest:()=>null},preventDefault(){},stopPropagation(){}});assert.equal(useSlate.getState().project.floor.items.length,1);assert.equal(ctx.captures,0);
 run('overhead-plan.tsx','onToggleLock',ctx.scope)();assert.equal(useSlate.getState().project.floor.items[0].locked,false);
 ctx=setup(structuredClone(useSlate.getState().project));Object.assign(ctx.scope,{sel,targetLocked:()=>false});run('overhead-plan.tsx','onRotate',ctx.scope,4)(90);assert.equal(useSlate.getState().project.floor.items[0].rotation,90);
});
test('optional camera path preserves authored points and rejects malformed finite-coordinate data',()=>{
 const p=fixture();p.floor.cameras=[{id:'camera',shotId:'shot',setup:'D2',x:.1,y:.2,angle:0,fov:34,path:[{x:.2,y:.3},{x:.8,y:.4}]}];
 assert.deepEqual(validateSnapshotProject(p).floor.cameras,p.floor.cameras);
 p.floor.cameras[0].path[0].x=Infinity;assert.throws(()=>validateSnapshotProject(p),/cameras.*path/);
});
test('drop consults live category locks rather than a stale render capture',()=>{
 const ctx=setup();ctx.scope.live.current.categoryLocked=new Set(['furniture']);
 const before=structuredClone(useSlate.getState().project);ctx.drop(JSON.stringify({type:'prop',projectId:'film',kind:'rect',label:'Lamp',productionItemId:'source'}));
 assert.deepEqual(useSlate.getState().project,before);assert.equal(ctx.captures,0);assert.match(ctx.messages[0],/unlock/);
});
for(const rerender of [false,true])test(`drop rejects setup switch ${rerender?'after':'before'} live ref refresh`,()=>{
 const p=fixture();p.shots.push(emptyShot({id:'new-shot',setup:'D3',sceneId:'scene',elementIds:['a']}));const ctx=setup(p);
 useSlate.setState({selectedId:'new-shot'});if(rerender)ctx.scope.live.current.shot=p.shots[1];
 const before=structuredClone(useSlate.getState().project);ctx.drop(JSON.stringify({type:'prop',projectId:'film',kind:'rect',label:'Lamp',productionItemId:'source'}));
 assert.deepEqual(useSlate.getState().project,before);assert.equal(ctx.captures,0);assert.match(ctx.messages[0],/setup changed/i);
});
test('drop retains deliberate null overview and selected first-shot fallback',()=>{
 const raw=JSON.stringify({type:'prop',projectId:'film',kind:'rect',label:'Lamp',productionItemId:'source'});
 let ctx=setup();ctx.scope.shot=null;ctx.scope.live.current.shot=null;ctx.drop(raw);assert.equal(useSlate.getState().project.floor.items[0].shotId,null);
 ctx=setup();useSlate.setState({selectedId:null});ctx.drop(raw);assert.equal(useSlate.getState().project.floor.items[0].shotId,'shot');
});
