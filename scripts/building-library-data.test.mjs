import test from 'node:test';
import assert from 'node:assert/strict';
import { blockSpec, catalogCard, prepareModel, constructionStages } from './building-library-data.mjs';
import { analyzeSpace } from './building-library-space.mjs';

test('烟囱蜘蛛网从图纸和材料中移除', () => {
  const card = catalogCard({id:'house',name:'农舍',width:2,height:3,depth:2,blockCount:3,styles:['medieval'],interior:'present'});
  const result = prepareModel({palette:[{name:'stone',properties:{}},{name:'cobweb',properties:{}}],blocks:[[0,0,0,0],[0,1,0,1],[0,2,0,1]]},card);
  assert.equal(result.card.removed.cobweb,2);
  assert.equal(result.card.materials.cobweb,undefined);
  assert.equal(result.model.palette.some(p=>p.includes('cobweb')),false);
  assert.deepEqual(result.model.size,[1,1,1]);
});

test('投影保留台阶、朝向和开合，门与床按一次放置记录', () => {
  assert.equal(blockSpec({name:'oak_slab',properties:{type:'double'}}),'oak_slab:double');
  assert.equal(blockSpec({name:'oak_trapdoor',properties:{facing:'east',half:'top',open:'true'}}),'oak_trapdoor:east:top:open');
  assert.equal(blockSpec({name:'oak_door',properties:{half:'upper'}}),null);
  assert.equal(blockSpec({name:'white_bed',properties:{part:'head'}}),null);
  assert.equal(blockSpec({name:'oak_wall_sign',properties:{facing:'north'}}),'oak_sign:wall:north');
  assert.equal(blockSpec({name:'oak_wall_hanging_sign',properties:{facing:'north'}}),'oak_hanging_sign:bracket:north');
  assert.equal(blockSpec({name:'tripwire',properties:{}}),'string');
});

test('房间净空按内墙和地面识别，床位保留在空间信息里',()=>{
  const palette=[{name:'stone',properties:{}},{name:'white_bed',properties:{part:'foot'}},{name:'white_bed',properties:{part:'head'}}],blocks=[];
  for(let x=0;x<9;x++)for(let z=0;z<9;z++){blocks.push([x,0,z,0],[x,4,z,0]);if(x===0||x===8||z===0||z===8)for(let y=1;y<4;y++)blocks.push([x,y,z,0]);}
  blocks.push([3,1,3,1],[3,1,4,2]);
  const result=analyzeSpace({palette,blocks},()=>[[0,0,0,1,1,1]]);
  assert.equal(result.metrics.bedCount,1);
  assert.equal(result.metrics.floorCount,1);
  assert.equal(result.metrics.largestRoom.area,49);
  assert.equal(result.metrics.largestRoom.rectangle.area,49);
});

test('有顶开放空间单独记录层数和用途',()=>{
  const palette=[{name:'stone',properties:{}}],blocks=[];
  for(let x=0;x<9;x++)for(let z=0;z<9;z++)blocks.push([x,0,z,0],[x,4,z,0]);
  for(const [x,z] of [[0,0],[0,8],[8,0],[8,8]])for(let y=1;y<4;y++)blocks.push([x,y,z,0]);
  const result=analyzeSpace({palette,blocks},()=>[[0,0,0,1,1,1]]);
  assert.equal(result.metrics.floorCount,1);
  assert.equal(result.metrics.enclosedFloorCount,0);
  assert.ok(result.space.includes('开放空间'));
});

test('悬空装饰的临时支撑带有收尾清理图纸', () => {
  const palette=['stone','lantern:hanging'];
  const result=constructionStages([[0,0,0,0],[2,3,0,1]],palette);
  assert.ok(result.supports>0);
  assert.equal(result.stages.at(-1).name,'收起临时垫脚');
  assert.ok(result.stages.at(-1).blocks.every(b=>palette[b[3]]==='.'));
});
