import { mkdirSync, readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { resolve, join, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { createRequire } from 'node:module';
import { catalogCard, prepareModel, readProjection } from './building-library-data.mjs';
import { analyzeSpace, renderFloorPlans } from './building-library-space.mjs';
import { render } from './references.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const input = resolve(option('--input', join(ROOT, '.cache', 'mcblock-import')));
const out = resolve(option('--out', join(ROOT, 'building-library')));
const body = JSON.parse(readFileSync(join(ROOT, 'config', 'xiaoke-body.json'), 'utf8'));
const mcp = resolve(ROOT, body.mcp);
const require = createRequire(join(mcp,'package.json'));
const registry = require('minecraft-data')('1.21.11');
const Block = require('prismarine-block')('1.21.11');
const shapeCache = new Map();
const getShapes = state => {
  const key=JSON.stringify(state);
  if(!shapeCache.has(key)) {
    let name=state.name;
    if(!registry.blocksByName[name]) name=({grass:'short_grass',chain:'iron_chain'})[name]||name;
    shapeCache.set(key,registry.blocksByName[name]?Block.fromProperties(name,state.properties,0).shapes:[[0,0,0,1,1,1]]);
  }
  return shapeCache.get(key);
};
for (const sub of ['models', 'previews', 'originals', 'cards', 'sources']) mkdirSync(join(out, sub), { recursive: true });

const source = JSON.parse(readFileSync(join(input, 'catalog-all.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(join(input, 'download-manifest.json'), 'utf8'));
const overridesFile = join(input, 'annotations.json');
const annotations = existsSync(overridesFile) ? JSON.parse(readFileSync(overridesFile, 'utf8')) : {};
const paths = new Map(manifest.map(x => [x.id, isAbsolute(x.path) ? x.path : resolve(input,x.path)]));
const cards = [];
for (const b of source.items) {
  let card = catalogCard(b);
  if (paths.has(b.id)) {
    const raw = await readProjection(paths.get(b.id), mcp);
    const prepared = prepareModel(raw, card,spec=>{const name=spec.split(':')[0];return (registry.blocksByName[name]??registry.blocksByName[({chain:'iron_chain',grass:'short_grass'})[name]])?.boundingBox==='block';});
    card = prepared.card;
    const more = annotations[b.id];
    if (more) {
      if(more.removeTags)card.tags=card.tags.filter(t=>!more.removeTags.includes(t));
      card.tags = [...new Set([...card.tags, ...(more.tags || [])])];
      card.summary = more.summary || card.summary;
      card.tagSources.push('预览人工整理');
      if (more.space) card.space = more.space;
    }
    const space=analyzeSpace(raw,getShapes);
    card.space=space.space;card.spaceMetrics=space.metrics;
    if(more?.layoutNote){card.layoutNote=more.layoutNote;card.space+=` 平面阅读补充：${more.layoutNote}`;}
    card.tags=[...new Set([...card.tags,...space.tags])];
    card.tagSources.push('室内碰撞形状与平面几何估算');
    if(!card.interior)card.tags.push('内饰待布置');
    writeFileSync(join(out,'previews',`${b.id}-floors.svg`),renderFloorPlans(space,card.name));
    const woodGroups=card.replacementGroups.filter(g=>!['masonry','windows'].includes(g.id));
    const mainWood=[...woodGroups].sort((a,b)=>b.materials.reduce((n,m)=>n+card.materials[m],0)-a.materials.reduce((n,m)=>n+card.materials[m],0))[0]?.id;
    const economyWood=Object.fromEntries(woodGroups.filter(g=>!['oak','spruce','birch','acacia','dark_oak'].includes(g.id)).map(g=>[g.id,'oak']));
    const economySwap=Object.fromEntries(Object.keys(card.materials).filter(n=>/^(quartz|smooth_quartz|prismarine|dark_prismarine|amethyst_block|purpur)/.test(n)).flatMap(n=>{
      if(n.endsWith('_pillar'))return [];
      const shape=n.match(/_(stairs|slab|wall)$/)?.[1];const target=shape?`cobblestone_${shape}`:'cobblestone';return registry.itemsByName[target]?[[n,target]]:[];
    }));
    card.paletteProfiles=[{name:'原配色',wood:{},swap:{}},{name:'易获取材料',wood:economyWood,swap:economySwap},{name:'金合欢暖色',wood:mainWood&&mainWood!=='acacia'?{[mainWood]:'acacia'}:{},swap:{}}];
    card.notes.push(`可选配色：${card.paletteProfiles.map(p=>p.name).join('、')}`);
    card.preview = `previews/${b.id}.webp`;
    card.model = `models/${b.id}.json.gz`;
    writeFileSync(join(out, card.model), gzipSync(JSON.stringify(prepared.model)));
    copyFileSync(paths.get(b.id), join(out, 'originals', `${b.id}.litematic`));
    const cover = join(input, 'covers', `${b.id}.webp`);
    if (existsSync(cover)) copyFileSync(cover, join(out, card.preview));
    const grid = new Map();
    for (const s of prepared.model.stages) for (const [x,y,z,p] of s.blocks) {const spec=prepared.model.palette[p];if(spec==='.')grid.delete(`${x},${y},${z}`);else grid.set(`${x},${y},${z}`,spec.split(':')[0]);}
    const [sx,sy,sz] = prepared.model.size;
    writeFileSync(join(out, 'previews', `${b.id}-structure.png`), render({ sx,sy,sz,at:(x,y,z)=>grid.get(`${x},${y},${z}`)||'air' }, 'se', 5));
    const materials = Object.entries(card.materials).sort((a,b)=>b[1]-a[1]).map(([n,c])=>`| ${n} | ${c} |`).join('\n');
    writeFileSync(join(out, 'cards', `${b.id}.md`), `# ${card.name}\n\n${card.summary}\n\n标签：${card.tags.join('、')}\n\n尺寸：${card.size.join('×')}（宽×高×深）；施工 ${card.buildBlockCount} 格，${card.stageCount} 段。\n\n${card.space}\n\n[室内平面图](../previews/${b.id}-floors.svg)\n\n${card.notes.join('；')}\n\n## 材料替换\n\n${card.replacementGroups.map(g=>`- ${g.label}：${g.materials.join('、')}。${g.rule}`).join('\n')}\n\n## 材料\n\n| 方块 | 物品数量 |\n|---|---:|\n${materials}\n\n来源：${card.source}\n作者：${card.author || '网站署名待补充'}\n`);
    console.log(`${card.name}: ${card.buildBlockCount} 格，${card.stageCount} 段，移除蜘蛛网 ${card.removed.cobweb || 0}`);
  }
  cards.push(card);
}
const index = { generatedAt: new Date().toISOString(), source: 'https://mcblock.top/buildings?type=residential', policy: { omittedBlocks: ['cobweb'], smoke: '蜘蛛网装饰烟雾在预处理和载入时省去' }, items: cards };
writeFileSync(join(out, 'catalog.json'), JSON.stringify(index));
writeFileSync(join(out,'sources','catalog-all.json'),JSON.stringify(source));
writeFileSync(join(out,'sources','annotations.json'),JSON.stringify(annotations,null,2));
writeFileSync(join(out,'sources','download-manifest.json'),JSON.stringify(manifest.map(x=>({id:x.id,path:`../originals/${x.id}.litematic`})),null,2));
const esc = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ready = cards.filter(c=>c.model);
writeFileSync(join(out, 'index.html'), `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>小克的本地建筑库</title><style>body{font:16px system-ui;margin:24px;background:#f7f5ef;color:#28342b}input{padding:12px;width:min(90%,600px)}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px;margin-top:24px}article{background:white;padding:16px;border-radius:12px}img{width:100%;aspect-ratio:4/3;object-fit:contain;background:#eceee8}p{line-height:1.6}small{color:#68786a}a{color:#317c55}</style><h1>小克的本地建筑库</h1><p>${cards.length} 座住宅目录，${ready.length} 栋已解析。尺寸为宽×高×深；蜘蛛网装饰烟雾已移除。</p><input id="q" placeholder="搜索名称、风格、水上、阳台、两层、木材…"><main>${ready.map(c=>`<article data-text="${esc(c.name+' '+c.tags.join(' ')+' '+c.summary+' '+(c.space||''))}"><img loading="lazy" src="${c.preview}" alt="${esc(c.name)}"><h2>${esc(c.name)}</h2><p>${esc(c.summary)}</p><p>${esc(c.space||'')}</p><small>${esc(c.tags.join(' · '))}</small><p>${c.size.join('×')} · ${c.buildBlockCount} 格 · ${c.stageCount} 段<br>${esc(c.notes.join('；'))}</p><a href="previews/${c.id}-floors.svg">室内平面图</a> · <a href="cards/${c.id}.md">材料与替换规则</a> · <a href="previews/${c.id}-structure.png">处理后结构预览</a></article>`).join('')}</main><script>document.getElementById('q').oninput=e=>{let q=e.target.value.trim().split(/\\s+/);document.querySelectorAll('article').forEach(c=>c.hidden=!q.every(w=>c.dataset.text.includes(w)))}</script>`);
console.log(JSON.stringify({ catalogued: cards.length, prepared: ready.length, out }));
