import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {itemCount,materialRows,lineRuns,indexPlan,validatePlan,stateId,boundsOf} from './web/js/plan.js';

const palette=[
  {name:'minecraft:acacia_planks',properties:{}},
  {name:'minecraft:cherry_planks',properties:{}},
  {name:'minecraft:cherry_door',properties:{half:'lower'}},
  {name:'minecraft:cherry_door',properties:{half:'upper'}},
  {name:'minecraft:red_bed',properties:{part:'foot'}},
  {name:'minecraft:red_bed',properties:{part:'head'}},
  {name:'minecraft:cherry_slab',properties:{type:'double'}}
];
const fixture=()=>({schemaVersion:1,id:'extension-test',revision:'r1',title:'Extension',captured:'2026-10-22',chapters:[{id:'deck',title:'Deck'}],
  blocks:[0,2,3,4,5,6].map((state,x)=>({x:x-3,y:-14,z:53,state,chapter:'deck'})),
  scene:{bounds:{},palette,geometry:palette.map(()=>({quads:[]})),atlas:'',columns:[],cherryMap:{0:1}},
  palettes:[{id:'original'},{id:'cherry'}],supports:[],preparation:[],expansionPorts:[]});

test('material counting preserves automatic blocks and double slabs',()=>{
  const p=fixture();assert.equal(p.blocks.reduce((n,b)=>n+itemCount(palette[b.state]),0),5);
  const rows=materialRows(p,p.blocks,'cherry',b=>b.state===0);
  assert.equal(rows.reduce((n,r)=>n+r.items,0),5);assert.equal(rows.reduce((n,r)=>n+r.left,0),4);
  assert.equal(rows.reduce((n,r)=>n+r.automatic,0),2);assert.equal(stateId(p,p.blocks[0],'cherry'),1);
});
test('chapter runs retain gaps and reference cells with inclusive counts',()=>{
  const p=fixture(),layer=[-3,-2,1].map(x=>({x,y:64,z:53,state:0})),others=[{x:2,y:64,z:53,state:0}];
  const r=lineRuns(p,'original',layer,others,'x',53,-4,3);
  assert.deepEqual(r.map(r=>r.count),[2,2,1,1]);assert.equal(r[1].id,null);assert.equal(r[3].ref,true);
});
test('new plans and negative world heights use the existing data contract',()=>{
  const p=validatePlan(fixture()),idx=indexPlan(p);assert.equal(idx.byY.get(-14).length,6);
  assert.deepEqual(boundsOf(p.blocks),{minX:-3,maxX:2,minY:-14,maxY:-14,minZ:53,maxZ:53});
});
test('all registered deployment plans load without changing their voxel counts',{skip:!process.env.PLANNER_SITE_DIR},()=>{
  const root=process.env.PLANNER_SITE_DIR,catalog=JSON.parse(readFileSync(resolve(root,'plans/index.json')));
  for(const entry of catalog.plans){const p=validatePlan(JSON.parse(readFileSync(resolve(root,'plans',entry.url)))),count=p.blocks.length;indexPlan(p);assert.equal(p.blocks.length,count);for(const color of p.palettes){const rows=materialRows(p,p.blocks,color.id);if(p.id==='lake-manor')assert.equal(rows.reduce((n,r)=>n+r.items,0),3101);}}
});
