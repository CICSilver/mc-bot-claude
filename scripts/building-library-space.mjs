const FURNITURE = /bed$|chest$|barrel$|furnace$|smoker$|crafting_table$|loom$|table$|lectern$|composter$|cauldron$|brewing_stand$|anvil$|grindstone$|stonecutter$|jukebox$|note_block$|decorated_pot$|flower_pot$|potted_|candle|carpet$|torch|lantern|button$|pressure_plate$|hanging_sign$|wall_sign$|banner$|rail$|lever$|tripwire|sapling$|tulip$|flower|grass$|fern$|vine|bush$|pink_petals|sea_pickle|amethyst_bud|amethyst_cluster|coral_fan$/;
const OUTDOOR = /leaves$|water$|lava$|cobweb$|scaffolding$|chain$|fence$|fence_gate$|wall$|end_rod$|lightning_rod$/;
const AIR = /^(air|cave_air|void_air|structure_void|barrier|light)$/;
const N4 = [[1,0],[-1,0],[0,1],[0,-1]];

export function largestRectangle(cells, width, depth) {
  const heights=Array(width).fill(0);let best={width:0,depth:0,area:0,x:0,z:0};
  for(let z=0;z<depth;z++) {
    for(let x=0;x<width;x++)heights[x]=cells.has(`${x},${z}`)?heights[x]+1:0;
    const stack=[];
    for(let x=0;x<=width;x++) {
      const current=x<width?heights[x]:0;
      while(stack.length && heights[stack.at(-1)]>current) {
        const index=stack.pop(),h=heights[index],left=stack.length?stack.at(-1)+1:0,w=x-left;
        if(w*h>best.area)best={width:w,depth:h,area:w*h,x:left,z:z-h+1};
      }
      stack.push(x);
    }
  }
  return best;
}

export function analyzeSpace(raw, getShapes) {
  const real=raw.blocks.filter(b=>!AIR.test(raw.palette[b[3]].name)&&raw.palette[b[3]].name!=='cobweb');
  const min=[0,1,2].map(i=>Math.min(...real.map(b=>b[i]))),max=[0,1,2].map(i=>Math.max(...real.map(b=>b[i])));
  const size=max.map((v,i)=>v-min[i]+1),[width,height,depth]=size;
  const states=raw.palette.map(s=>({ ...s, furniture:FURNITURE.test(s.name), outdoor:OUTDOOR.test(s.name), door:/_door$/.test(s.name)&&!/_trapdoor$/.test(s.name), shapes:getShapes(s) }));
  const grid=new Map(), columns=new Map(),beds=[];
  for(const b of real) {
    const [x,y,z]=b.slice(0,3).map((v,i)=>v-min[i]),s=states[b[3]];
    grid.set(`${x},${y},${z}`,s);
    const k=`${x},${z}`;if(!columns.has(k))columns.set(k,[]);columns.get(k).push({y,s});
    if(s.name.endsWith('_bed')&&s.properties.part==='foot')beds.push({x,y,z});
  }
  const structural=s=>s&&!s.furniture&&!s.outdoor;
  const intersects=(box,foot,by)=>box[3]>.2&&box[0]<.8&&box[5]>.2&&box[2]<.8&&by+box[4]>foot+.02&&by+box[1]<foot+1.8;
  const clear=(x,z,foot,shell=false)=>{
    for(let y=Math.floor(foot);y<=Math.floor(foot+1.8);y++){
      const s=grid.get(`${x},${y},${z}`);if(!s)continue;
      if(s.door){if(shell)return false;continue;}
      if(shell&&!structural(s))continue;
      if(s.shapes.some(box=>intersects(box,foot,y)))return false;
    }
    return true;
  };
  const roof=(x,z,foot)=>(columns.get(`${x},${z}`)||[]).some(({y,s})=>y>=foot+1.8&&structural(s)&&!s.door&&s.shapes.some(b=>b[4]>=.5));
  const byLevel=new Map(),walk=new Map();
  for(const [key,column] of columns) {
    const [x,z]=key.split(',').map(Number);
    for(const {y,s} of column) {
      if(!structural(s)||s.door)continue;
      for(const box of s.shapes) {
        if(box[3]<.5||box[0]>.5||box[5]<.5||box[2]>.5)continue;
        const foot=y+box[4];if(Math.abs(foot*2-Math.round(foot*2))>.01)continue;
        if(clear(x,z,foot)) {if(!walk.has(key))walk.set(key,new Set());walk.get(key).add(foot);}
        if(!clear(x,z,foot,true)||!roof(x,z,foot))continue;
        if(!byLevel.has(foot))byLevel.set(foot,new Set());byLevel.get(foot).add(key);
      }
    }
  }
  const rooms=[];
  for(const [foot,floors] of byLevel) {
    if(floors.size<9)continue;
    const outside=new Set(),queue=[[-1,-1]];outside.add('-1,-1');
    for(let i=0;i<queue.length;i++) {
      const [x,z]=queue[i];
      for(const [dx,dz] of N4){const nx=x+dx,nz=z+dz,k=`${nx},${nz}`;if(nx < -1||nx>width||nz < -1||nz>depth||outside.has(k)||!clear(nx,nz,foot,true))continue;outside.add(k);queue.push([nx,nz]);}
    }
    const inside=new Set([...floors].filter(k=>!outside.has(k)));
    while(inside.size) {
      const seed=inside.values().next().value,component=new Set([seed]),pending=[seed];inside.delete(seed);
      for(let i=0;i<pending.length;i++){const [x,z]=pending[i].split(',').map(Number);for(const [dx,dz]of N4){const k=`${x+dx},${z+dz}`;if(inside.delete(k)){component.add(k);pending.push(k);}}}
      if(component.size<9)continue;
      const rectangle=largestRectangle(component,width,depth);
      if(Math.min(rectangle.width,rectangle.depth)<3)continue;
      rooms.push({foot,area:component.size,rectangle,beds:beds.filter(b=>Math.abs(b.y-foot)<1&&component.has(`${b.x},${b.z}`)).length,cells:component});
    }
  }
  const levels=[];
  for(const r of rooms.sort((a,b)=>a.foot-b.foot)){
    let level=levels.find(l=>Math.abs(l.foot-r.foot)<2.5);
    if(!level){level={foot:r.foot,rooms:[]};levels.push(level);}level.rooms.push(r);
  }
  for(const l of levels){const counts=new Map();for(const r of l.rooms)counts.set(r.foot,(counts.get(r.foot)||0)+r.area);l.foot=[...counts].sort((a,b)=>b[1]-a[1])[0][0];l.rooms=l.rooms.filter(r=>r.foot===l.foot);}
  const coveredLevels=[];
  const peak=Math.max(0,...[...byLevel.values()].map(s=>s.size));
  for(const [foot,cells] of [...byLevel].sort((a,b)=>a[0]-b[0])) {
    if(cells.size<Math.max(12,peak*.15))continue;
    let level=coveredLevels.find(l=>Math.abs(l.foot-foot)<2.5);
    if(!level){level={foot,cells};coveredLevels.push(level);}else if(cells.size>level.cells.size){level.foot=foot;level.cells=cells;}
  }
  const selected=levels.flatMap(l=>l.rooms),largest=[...selected].sort((a,b)=>b.rectangle.area-a.rectangle.area)[0];
  const bedRooms=selected.filter(r=>r.beds).length;
  const connected=[];const todo=new Set([...walk].flatMap(([k,values])=>[...values].map(y=>`${k},${y}`)));
  while(todo.size){const first=todo.values().next().value,pending=[first],floorIds=new Set();todo.delete(first);for(let i=0;i<pending.length;i++){const [x,z,y]=pending[i].split(',').map(Number);for(let j=0;j<levels.length;j++)if(Math.abs(levels[j].foot-y)<.01&&levels[j].rooms.some(r=>r.cells.has(`${x},${z}`)))floorIds.add(j);for(const [dx,dz]of N4)for(const ny of walk.get(`${x+dx},${z+dz}`)||[]){if(Math.abs(ny-y)>1.01)continue;const k=`${x+dx},${z+dz},${ny}`;if(todo.delete(k))pending.push(k);}}connected.push(floorIds.size);}
  const metrics={method:'按方块碰撞形状估算有顶地面；门按关闭划分封闭区域，家具从净空轮廓中略去',floorCount:coveredLevels.length,enclosedFloorCount:levels.length,bedCount:beds.length,bedRoomCount:bedRooms,connectedEnclosedFloors:Math.max(0,...connected),largestRoom:largest?{area:largest.area,rectangle:largest.rectangle,footY:largest.foot}:null,levels:coveredLevels.map(l=>({footY:l.foot,coveredArea:l.cells.size,largestRectangle:largestRectangle(l.cells,width,depth)})),enclosedLevels:levels.map(l=>({footY:l.foot,area:l.rooms.reduce((n,r)=>n+r.area,0),roomCount:l.rooms.length,largestRectangle:l.rooms.map(r=>r.rectangle).sort((a,b)=>b.area-a.area)[0]}))};
  const space=`室内几何估算：有顶地面分布${coveredLevels.length}个高度层；${largest?`最大封闭区域地面${largest.area}格，最大净空矩形${largest.rectangle.width}×${largest.rectangle.depth}格`:'开放空间与露台可按用途划分'}；床位${beds.length}，含床封闭区域${bedRooms}。`;
  const tags=[];
  if(coveredLevels.length>=2)tags.push('多层有顶空间');if(beds.length>=2)tags.push('多床位');
  if(largest&&largest.rectangle.area>=63&&Math.min(largest.rectangle.width,largest.rectangle.depth)>=7)tags.push('大房间净空');
  if(bedRooms>=2)tags.push('多卧室区域');
  return {metrics,space,tags,plans:coveredLevels.map(l=>({footY:l.foot,cells:l.cells})),grid,size};
}

export function renderFloorPlans(result,title) {
  const [w,,d]=result.size,tile=12,pad=24,panelW=w*tile+pad*2,panelH=d*tile+80;
  const levels=result.plans.length?result.plans:[{footY:1,cells:new Set()}];
  const panels=levels.map((l,i)=>{
    let cells='';
    for(let z=0;z<d;z++){
      let start=0,previous;
      for(let x=0;x<=w;x++){
        const s=result.grid.get(`${x},${Math.floor(l.footY)},${z}`);let color=x===w?null:l.cells.has(`${x},${z}`)?'#cee7ce':'#f5f2e9';
        if(x<w&&s&&!AIR.test(s.name)&&!s.furniture&&!s.outdoor)color=s.door?'#d3a66e':/glass/.test(s.name)?'#a8d5ea':'#787b76';
        if(x<w&&s?.name.endsWith('_bed'))color='#df8c91';
        if(color!==previous){if(previous&&previous!=='#f5f2e9')cells+=`<rect x="${pad+start*tile}" y="${48+z*tile}" width="${(x-start)*tile}" height="${tile}" fill="${previous}"/>`;start=x;previous=color;}
      }
    }
    return `<g transform="translate(${i*panelW},0)"><text x="24" y="25" font-size="16">平面${i+1} · 相对脚底 Y=${l.footY}</text><rect x="${pad}" y="48" width="${w*tile}" height="${d*tile}" fill="#f5f2e9"/>${cells}<rect x="${pad}" y="48" width="${w*tile}" height="${d*tile}" fill="url(#grid)"/></g>`;
  }).join('');
  const esc=s=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${panelW*levels.length}" height="${panelH+60}" viewBox="0 0 ${panelW*levels.length} ${panelH+60}"><defs><pattern id="grid" width="12" height="12" patternUnits="userSpaceOnUse"><path d="M12 0H0V12" fill="none" stroke="#d7d7cd" stroke-width=".5"/></pattern></defs><rect width="100%" height="100%" fill="#faf8f1"/><g font-family="Microsoft YaHei, sans-serif" fill="#28342b"><text x="24" y="26" font-size="20">${esc(title)} · 室内平面估算（绿色为可用地面）</text><g transform="translate(0,48)">${panels}</g></g></svg>`;
}
