import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

export const STYLE_NAMES = { medieval: '中世纪', modern: '现代', chinese: '中式', japanese: '日式', european: '欧式', fantasy: '幻想', industrial: '工业', scifi: '科幻', desert: '沙漠', western: '西部', ancient: '古文明', rustic: '田园', minimal: '简约' };
export const WOODS = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry', 'pale_oak', 'bamboo', 'crimson', 'warped'];
const WOOD_CN = ['橡木', '云杉木', '白桦木', '丛林木', '金合欢木', '深色橡木', '红树木', '樱花木', '苍白橡木', '竹', '绯红木', '诡异木'];
const EMPTY = /^(air|cave_air|void_air|structure_void|light|barrier|jigsaw)$/;
export const OMIT = new Set(['cobweb']);
const PLANTS = /^(wheat|carrots|potatoes|beetroots|pumpkin_stem|melon_stem|attached_pumpkin_stem|attached_melon_stem|sweet_berry_bush|water|lava|bubble_column|cave_vines|cave_vines_plant|big_dripleaf_stem|big_dripleaf|cocoa|piston_head|nether_portal|kelp_plant|kelp|weeping_vines|weeping_vines_plant|twisting_vines|twisting_vines_plant)$/;
const DETAIL = /(_door|_trapdoor|_fence_gate|_button|_pressure_plate|_sign|_banner|_bed|_carpet|_sapling|_flower|_tulip|_bush)$|torch|lantern|chain|flower_pot|potted_|candle|brewing_stand|campfire|lightning_rod|end_rod|bell|rail|lever|tripwire|lily_pad|pink_petals|short_grass|tall_grass|fern|vine/;

export function catalogCard(b) {
  const tags = ['住宅', ...(b.styles || []).map(s => STYLE_NAMES[s] || s)];
  const n = b.name;
  for (const [rx, words] of [
    [/水上|海港|海马|湖畔|守海|渔/, ['水边']], [/水上|海马/, ['水上']],
    [/林间|森林|林中|丛林|树根|绿叶|树屋/, ['林间']], [/农|田园|乡村|野营/, ['田园']],
    [/农田|农舍|农场/, ['农田']], [/别墅|庄园|府邸|大房屋|大屋|公寓/, ['家庭住宅']],
    [/阳台|露台/, ['阳台']], [/两层|双层|二层/, ['两层']], [/三层/, ['三层']],
    [/四层/, ['四层']], [/樱花|粉|莓|草莓/, ['粉色']], [/白|石英|砂岩/, ['浅色']],
    [/深色|黑石/, ['深色']], [/砖|泥瓦/, ['砖瓦屋顶']], [/木屋|木制|木质/, ['木屋']],
  ]) if (rx.test(n)) tags.push(...words);
  if (b.interior === 'present') tags.push('含内饰');
  const area = b.width * b.depth;
  tags.push(area >= 400 ? '大占地' : area >= 225 ? '中等占地' : '紧凑占地');
  return {
    id: b.id, name: n, tags: [...new Set(tags)], size: [b.width, b.height, b.depth],
    blockCount: b.blockCount, interior: b.interior === 'present', difficulty: b.difficulty,
    source: `https://mcblock.top/buildings/${b.id}`, author: b.projectionAuthor || '',
    cover: b.coverImage?.startsWith('/') ? `https://mcblock.top${b.coverImage}` : b.coverImage,
    projectionVersion: b.projectionVersion, status: 'catalogued',
    summary: `${(b.styles || []).map(s => STYLE_NAMES[s] || s).join('、')}住宅；外轮廓${b.width}×${b.depth}格，高${b.height}格；${b.interior === 'present' ? '带内饰' : '适合另行布置内饰'}。`,
    tagSources: ['网站分类', '名称关键词', '外轮廓尺寸'],
  };
}

export async function readProjection(file, mcpRoot) {
  const nbt = createRequire(`${mcpRoot.replace(/\\/g, '/')}/package.json`)('prismarine-nbt');
  const root = nbt.simplify((await nbt.parse(readFileSync(file))).parsed);
  const palette = [], paletteIds = new Map(), blocks = [];
  const add = (x, y, z, raw) => {
    const state = { name: raw.Name.replace(/^minecraft:/, ''), properties: raw.Properties || {} };
    if (EMPTY.test(state.name)) return;
    const key = JSON.stringify(state);
    if (!paletteIds.has(key)) { paletteIds.set(key, palette.length); palette.push(state); }
    blocks.push([x, y, z, paletteIds.get(key)]);
  };
  if (root.Regions) {
    for (const r of Object.values(root.Regions)) {
      const sx = Math.abs(r.Size.x), sy = Math.abs(r.Size.y), sz = Math.abs(r.Size.z);
      const bits = Math.max(2, Math.ceil(Math.log2(r.BlockStatePalette.length)));
      const longs = r.BlockStates.map(([hi, lo]) => (BigInt(hi >>> 0) << 32n) | BigInt(lo >>> 0));
      const mask = (1n << BigInt(bits)) - 1n;
      const origin = ['x', 'y', 'z'].map(k => r.Position[k] + Math.min(0, r.Size[k] + 1));
      for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
        const bit = BigInt(((y * sz + z) * sx + x) * bits), idx = Number(bit >> 6n), off = bit & 63n;
        let value = longs[idx] >> off;
        if (off + BigInt(bits) > 64n) value |= longs[idx + 1] << (64n - off);
        add(origin[0] + x, origin[1] + y, origin[2] + z, r.BlockStatePalette[Number(value & mask)]);
      }
    }
  } else {
    const states = root.palette || root.palettes[0];
    for (const b of root.blocks) add(...b.pos, states[b.state]);
  }
  return { palette, blocks };
}

export function blockSpec(state) {
  let { name } = state;
  const p = state.properties;
  if (OMIT.has(name) || PLANTS.test(name)) return null;
  if (name.endsWith('_door') && !name.endsWith('_trapdoor') && p.half === 'upper') return null;
  if (name.endsWith('_bed') && p.part === 'head') return null;
  if(['tall_grass','large_fern','sunflower','lilac','rose_bush','peony','pitcher_plant'].includes(name)&&p.half==='upper')return null;
  const suffix = [];
  if (name.startsWith('potted_')) name = 'flower_pot';
  if (name === 'grass') name = 'short_grass';
  if (name === 'tripwire') name = 'string';
  if (name === 'bamboo_sapling') name = 'bamboo';
  if (name === 'weeping_vines_plant') name = 'weeping_vines';
  if (name === 'twisting_vines_plant') name = 'twisting_vines';
  if (name === 'iron_chain') name = 'chain';
  if (name === 'water_cauldron' || name === 'lava_cauldron' || name === 'powder_snow_cauldron') name = 'cauldron';
  if (name === 'redstone_wire') name = 'redstone';
  if (name === 'farmland' || name === 'dirt_path') name = 'dirt';
  if (name.includes('_wall_hanging_sign')) { name = name.replace('_wall_hanging_sign', '_hanging_sign'); suffix.push('bracket'); }
  else if(name.endsWith('_hanging_sign'))suffix.push('hanging');
  else if (name.includes('_wall_sign')) { name = name.replace('_wall_sign', '_sign'); suffix.push('wall'); }
  else if (name.includes('_wall_banner')) { name = name.replace('_wall_banner', '_banner'); suffix.push('wall'); }
  else if (name === 'wall_torch' || name.endsWith('_wall_torch')) { name = name.replace('wall_', ''); suffix.push('wall'); }
  else if (name.endsWith('_coral_wall_fan')) { name = name.replace('_wall_fan', '_fan'); suffix.push('wall'); }
  else if (/_wall_(skull|head)$/.test(name)) { name=name.replace('_wall_','_');suffix.push('wall'); }
  if (p.facing && ['north', 'east', 'south', 'west'].includes(p.facing)) suffix.push(p.facing);
  if (p.axis) suffix.push(p.axis);
  if (['top', 'bottom'].includes(p.half)) suffix.push(p.half);
  if (['top', 'bottom', 'double'].includes(p.type) && name.endsWith('_slab')) suffix.push(p.type);
  if (p.hanging === 'true') suffix.push('hanging');
  if (p.face === 'wall') suffix.push('wall');
  if (p.open === 'true') suffix.push('open');
  if (p.open === 'false') suffix.push('closed');
  if (p.rotation) suffix.push(`rot${p.rotation}`);
  return [name, ...suffix].join(':');
}

export function replacementGroups(materials) {
  const groups = [];
  for (let i = 0; i < WOODS.length; i++) {
    const wood = WOODS[i];
    const names = Object.keys(materials).filter(n => n.startsWith(`${wood}_`) || n.startsWith(`stripped_${wood}_`));
    if (names.length) groups.push({ id: wood, label: `${WOOD_CN[i]}配色组`, materials: names,
      alternatives: WOODS.filter(w => w !== wood && !['bamboo', 'crimson', 'warped'].includes(w)),
      rule: '整组替换相同形状；保留朝向、台阶位置、门窗开合。' });
  }
  const stone = Object.keys(materials).filter(n => /^(cobblestone|stone_brick|deepslate|sandstone|smooth_sandstone|quartz|smooth_quartz|brick)/.test(n));
  if (stone.length) groups.push({ id: 'masonry', label: '墙体与屋顶石材', materials: stone, alternatives: ['cobblestone', 'stone_bricks', 'sandstone', 'quartz'], rule: '按完整方块、楼梯、台阶、围墙分别配对；整体配色与玩家商量。' });
  const glass = Object.keys(materials).filter(n => /glass/.test(n));
  if (glass.length) groups.push({ id: 'windows', label: '窗户', materials: glass, alternatives: ['glass', 'white_stained_glass', 'light_blue_stained_glass'], rule: '玻璃板保持板形，玻璃块保持块形。' });
  return groups;
}

// 按相邻支撑排施工顺序，跨分块的屋檐和悬挂装饰沿用前段已建的支撑。
export function constructionStages(blocks, palette, canSupport=()=>true) {
  const key = b => b.slice(0,3).join(',');
  const finishing=blocks.filter(b=>!canSupport(palette[b[3]]));
  const rest = new Map(blocks.filter(b=>canSupport(palette[b[3]])).map(b => [key(b), b]));
  const placed = new Set(), ready = new Set(), stages = [], supports = [];
  const automatic = new Map();
  const reserved = new Set();
  for(const b of blocks) {
    const spec=palette[b[3]],name=spec.split(':')[0];let cell;
    if(/_door$/.test(name)&&!/_trapdoor$/.test(name))cell=[b[0],b[1]+1,b[2]];
    else if(/_bed$/.test(name)) {
      const facing=spec.split(':').find(p=>['north','south','east','west'].includes(p));
      const [dx,dz]=({north:[0,-1],south:[0,1],east:[1,0],west:[-1,0]})[facing]||[0,0];cell=[b[0]+dx,b[1],b[2]+dz];
    }
    if(cell){reserved.add(cell.join(','));automatic.set(key(b),cell);}
  }
  const directions = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
  const supported = b => {
    const spec = palette[b[3]], parts = spec.split(':');
    let faces = directions;
    if (parts.includes('hanging')) faces = [[0,1,0]];
    else if(parts.includes('bracket'))faces=parts.includes('north')||parts.includes('south')?[[1,0,0],[-1,0,0]]:[[0,0,1],[0,0,-1]];
    else if (parts.includes('wall')) {
      const facing = parts.find(p => ['north','south','east','west'].includes(p));
      faces = ({north:[[0,0,1]],south:[[0,0,-1]],east:[[-1,0,0]],west:[[1,0,0]]})[facing] || directions;
    } else if (/_door$/.test(parts[0]) && !/_trapdoor$/.test(parts[0])) faces = [[0,-1,0]];
    return faces.some(([x,y,z]) => b[1]+y < 0 || placed.has(`${b[0]+x},${b[1]+y},${b[2]+z}`));
  };
  const refresh = b => {
    for (const [x,y,z] of directions) {
      const k = `${b[0]+x},${b[1]+y},${b[2]+z}`, next = rest.get(k);
      if (next && supported(next)) ready.add(k);
    }
  };
  for (const [k,b] of rest) if (supported(b)) ready.add(k);
  const bucket = b => [Math.floor(b[0]/20),Math.floor(b[1]/20),Math.floor(b[2]/20)].join(',');
  while (rest.size) {
    if (!ready.size) {
      const seed = [...rest.values()].sort((a,b)=>a[1]-b[1])[0];
      const spec = palette[seed[3]], facing = spec.split(':').find(p=>['north','south','east','west'].includes(p));
      const wallOffset = {north:[0,0,1],south:[0,0,-1],east:[-1,0,0],west:[1,0,0]}[facing];
      let anchor = spec.includes(':wall') && wallOffset ? seed.slice(0,3).map((v,i)=>v+wallOffset[i]) : [seed[0],seed[1]-1,seed[2]];
      if (spec.includes(':hanging')) anchor = [seed[0],seed[1]+1,seed[2]];
      const columnX = spec.includes(':hanging') ? anchor[0]+1 : anchor[0];
      let dirt = palette.indexOf('dirt'); if (dirt < 0) { dirt=palette.length;palette.push('dirt'); }
      const additions = [];
      for (let y=0;y<=anchor[1];y++) {
        const b=[columnX,y,anchor[2],dirt], k=key(b);
        if (!rest.has(k) && !placed.has(k) && !reserved.has(k)) {rest.set(k,b);supports.push(b);additions.push(b);}
      }
      const a=[...anchor,dirt], k=key(a);
      if (!rest.has(k) && !placed.has(k) && !reserved.has(k)) {rest.set(k,a);supports.push(a);additions.push(a);}
      for (const [k,b] of rest) if (supported(b)) ready.add(k);
      if (!ready.size) throw new Error(`需要整理支撑顺序：${key(seed)} ${spec}`);
    }
    const first = [...ready].map(k=>rest.get(k)).sort((a,b)=>a[1]-b[1] || Number(DETAIL.test(palette[a[3]]))-Number(DETAIL.test(palette[b[3]])))[0];
    const tile = bucket(first), cells = [];
    while (cells.length < 1000) {
      const next = [...ready].map(k=>rest.get(k)).filter(b=>bucket(b)===tile).sort((a,b)=>a[1]-b[1])[0];
      if (!next) break;
      const k=key(next);ready.delete(k);rest.delete(k);placed.add(k);cells.push(next);refresh(next);
      const auto=automatic.get(k);if(auto){placed.add(auto.join(','));refresh(auto);}
    }
    stages.push({name:`施工-${stages.length+1}`,blocks:cells});
  }
  if (supports.length) {
    let dig=palette.indexOf('.');if(dig<0){dig=palette.length;palette.push('.');}
    const tiles=new Map();
    for(const b of supports.sort((a,b)=>b[1]-a[1])){const k=bucket(b);if(!tiles.has(k))tiles.set(k,[]);tiles.get(k).push([...b.slice(0,3),dig]);}
    for(const cells of tiles.values())stages.push({name:'收起临时垫脚',blocks:cells});
  }
  const finishTiles=new Map();
  for(const b of supports)placed.delete(key(b));
  const deferred=[];
  for(const b of finishing){if(!supported(b)){deferred.push(b);continue;}const k=bucket(b);if(!finishTiles.has(k))finishTiles.set(k,[]);finishTiles.get(k).push(b);}
  for(const cells of finishTiles.values())stages.push({name:'栽种与细部',blocks:cells.sort((a,b)=>a[1]-b[1])});
  const compacted = [];
  for (const stage of stages) {
    const previous = compacted.at(-1);
    if (previous && (stage.name === '收起临时垫脚') === (previous.name === '收起临时垫脚') && (stage.name==='栽种与细部') === (previous.name==='栽种与细部')) {
      const cells = [...previous.blocks, ...stage.blocks];
      const spans = [0,1,2].map(i=>Math.max(...cells.map(b=>b[i]))-Math.min(...cells.map(b=>b[i]))+1);
      if (cells.length <= 2400 && spans.every(n=>n<=24)) { previous.blocks=cells;continue; }
    }
    compacted.push({...stage,blocks:[...stage.blocks]});
  }
  return {stages:compacted,supports:supports.length,deferred};
}

export function prepareModel(raw, card, canSupport) {
  const removed = {}, materials = {}, used = [], specs = [], specIds = new Map();
  const byPos = new Map();
  for (const b of raw.blocks) byPos.set(b.slice(0, 3).join(','), b);
  for (const b of byPos.values()) {
    const state = raw.palette[b[3]], spec = blockSpec(state);
    if (!spec) { removed[state.name] = (removed[state.name] || 0) + 1; continue; }
    if (!specIds.has(spec)) { specIds.set(spec, specs.length); specs.push(spec); }
    used.push([b[0], b[1], b[2], specIds.get(spec)]);
    const item = spec.split(':')[0];
    materials[item] = (materials[item] || 0) + (spec.includes(':double') ? 2 : 1);
  }
  const min = [0, 1, 2].map(i => Math.min(...used.map(b => b[i])));
  const max = [0, 1, 2].map(i => Math.max(...used.map(b => b[i])));
  const size = max.map((v, i) => v - min[i] + 1);
  const blocks = used.map(b => [b[0] - min[0], b[1] - min[1], b[2] - min[2], b[3]])
    .sort((a, b) => a[1] - b[1] || a[2] - b[2] || a[0] - b[0]);
  const {stages,supports,deferred} = constructionStages(blocks,specs,canSupport);
  const deferredDecorations={};
  for(const b of deferred){const spec=specs[b[3]],item=spec.split(':')[0];deferredDecorations[item]=(deferredDecorations[item]||0)+1;materials[item]-=spec.includes(':double')?2:1;if(!materials[item])delete materials[item];}
  if (supports) materials.dirt=(materials.dirt||0)+supports;
  const groups = replacementGroups(materials);
  const extra = [];
  if (removed.cobweb) extra.push(`已省去${removed.cobweb}格蜘蛛网装饰烟雾`);
  if(deferred.length)extra.push(`${deferred.length}格悬空细部转为现场布置：${Object.entries(deferredDecorations).map(([n,c])=>`${n} ${c}`).join('、')}`);
  if (supports) extra.push(`施工使用${supports}格临时泥土支撑，收尾图纸会收起`);
  if (Object.keys(removed).some(n => PLANTS.test(n))) extra.push('水体、耕地种植结合现场另外安排');
  if (removed.nether_portal) extra.push('黑曜石门框保留，传送门点火在现场安排');
  if (raw.palette.some(p => p.name.startsWith('potted_'))) extra.push('花盆保留，花草由小克现场挑选');
  if (Object.keys(materials).some(n => n.endsWith('_sign'))) extra.push('告示牌位置保留，文字由小克现场填写');
  return {
    model: { size, palette: specs, stages, removed, deferredDecorations, sourceBlockCount: raw.blocks.length, temporarySupports:supports },
    card: { ...card, status: 'prepared', size, buildBlockCount: blocks.length-deferred.length, materials, replacementGroups: groups,deferredDecorations,
      stageCount: stages.length, removed, notes: extra, tags: [...new Set([...card.tags,
        ...groups.filter(g => WOODS.includes(g.id)).map(g => g.label.replace('配色组', '')),
        ...(removed.cobweb ? ['已去装饰烟雾'] : [])])],
      tagSources: [...card.tagSources, '投影逐格解析'],
    },
  };
}
