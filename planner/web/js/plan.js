// 方案数据核心：校验、索引、材料统计、属性翻译。与原版 plan-core.js 的计数规则保持一致。
export const keyOf = b => `${b.x},${b.y},${b.z}`;
export const ALL = 'all';

// —— 校验：与原版 validatePlan 一致，并补充 plan.schema.json 的必填字段检查 ——
const REQUIRED = ['schemaVersion','id','revision','title','captured','chapters','blocks','scene','palettes','supports','preparation','expansionPorts'];
export function validatePlan(plan) {
  if (!plan || typeof plan !== 'object') throw Error('方案文件不是有效的 JSON 对象');
  if (plan.schemaVersion !== 1) throw Error('不支持的建造方案格式（schemaVersion 必须为 1）');
  const missing = REQUIRED.filter(k => !(k in plan));
  if (missing.length) throw Error('方案缺少字段：' + missing.join('、'));
  if (!/^[a-z0-9-]+$/.test(plan.id)) throw Error('方案 id 格式无效');
  for (const k of ['chapters','blocks','palettes']) if (!Array.isArray(plan[k]) || !plan[k].length) throw Error(`方案字段 ${k} 必须是非空数组`);
  for (const k of ['supports','preparation','expansionPorts']) if (!Array.isArray(plan[k])) throw Error(`方案字段 ${k} 必须是数组`);
  const sc = plan.scene;
  for (const k of ['bounds','palette','geometry','atlas','columns','cherryMap']) if (!sc || !(k in sc)) throw Error('方案 scene 缺少字段：' + k);
  for (const p of plan.palettes) if (!['original','cherry'].includes(p.id)) throw Error('未知配色：' + p.id);
  const chapters = new Set(plan.chapters.map(c => c.id)), seen = new Set();
  for (const b of plan.blocks) {
    if (!chapters.has(b.chapter) || !sc.geometry[b.state] || ![b.x,b.y,b.z].every(Number.isInteger)) throw Error('方案包含无效方块或章节');
    const k = keyOf(b); if (seen.has(k)) throw Error('方案存在重复坐标：' + k); seen.add(k);
  }
  return plan;
}

export const stateId = (plan, block, palette) => palette === 'cherry' ? (plan.scene.cherryMap[block.state] ?? block.state) : block.state;
export const stateOf = (plan, block, palette) => plan.scene.palette[stateId(plan, block, palette)];

// 门上半、床头为自动生成格（0 件）；双层台阶算 2 件
export function itemCount(s) {
  if (s.air || s.name.endsWith('_door') && s.properties.half === 'upper' || s.name.endsWith('_bed') && s.properties.part === 'head') return 0;
  return s.name.endsWith('_slab') && s.properties.type === 'double' ? 2 : 1;
}
export function stackSize(name) {
  if (/_bed$|_banner_pattern$|bucket$|_boat$|minecart$|potion$|totem/.test(name)) return 1;
  if (/_sign$|_hanging_sign$|_banner$|egg$|snowball$|ender_pearl$|honey_bottle$/.test(name)) return 16;
  return 64;
}
export function stackText(n, name) {
  const s = stackSize(name);
  if (n < s || s === 1) return '';
  const g = Math.floor(n / s), r = n % s;
  return `${g} 组${r ? ' + ' + r : ''}`;
}

// 预处理：索引全部方块
export function indexPlan(plan) {
  const byKey = new Map(), byY = new Map();
  plan.blocks.forEach((b, i) => {
    b.i = i; byKey.set(keyOf(b), b);
    if (!byY.has(b.y)) byY.set(b.y, []); byY.get(b.y).push(b);
  });
  const chapterIndex = new Map(plan.chapters.map((c, i) => [c.id, i]));
  return { byKey, byY, chapterIndex };
}
export function boundsOf(blocks) {
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const b of blocks) {
    if (b.x < minX) minX = b.x; if (b.x > maxX) maxX = b.x;
    if (b.y < minY) minY = b.y; if (b.y > maxY) maxY = b.y;
    if (b.z < minZ) minZ = b.z; if (b.z > maxZ) maxZ = b.z;
  }
  return { minX, minY, minZ, maxX, maxY, maxZ };
}

export function materialRows(plan, blocks, palette, isDone) {
  const rows = new Map();
  for (const b of blocks) {
    const sid = stateId(plan, b, palette), s = plan.scene.palette[sid], n = itemCount(s);
    if (!rows.has(s.name)) rows.set(s.name, { id: s.name, name: s.displayName || s.name, state: sid, items: 0, left: 0, cells: 0, automatic: 0 });
    const r = rows.get(s.name); r.items += n; r.cells++; if (!n) r.automatic++;
    if (!isDone?.(b)) r.left += n;
  }
  return [...rows.values()].sort((a, b) => b.items - a.items || a.id.localeCompare(b.id));
}

// 一行/一列的连续段（原版“格数标注”）
export function lineRuns(plan, palette, layer, others, axis, fixed, min, max) {
  const other = axis === 'x' ? 'z' : 'x';
  const cells = new Map(layer.filter(b => b[other] === fixed).map(b => [b[axis], b]));
  const refs = new Set(others.filter(b => b[other] === fixed).map(b => b[axis]));
  const runs = [];
  for (let p = min; p <= max; p++) {
    const b = cells.get(p), s = b ? stateOf(plan, b, palette) : null, ref = !b && refs.has(p);
    const sig = s ? `${s.name}|${JSON.stringify(s.properties)}` : ref ? 'ref' : 'air';
    const last = runs.at(-1);
    if (last?.sig === sig) { last.end = p; last.count++; }
    else runs.push({ start: p, end: p, count: 1, sig, id: s?.name ?? null, name: s ? (s.displayName || s.name) : ref ? '其他章节' : '留空', ref });
  }
  // 去掉两端的留空
  while (runs[0] && !runs[0].id && !runs[0].ref) runs.shift();
  while (runs.at(-1) && !runs.at(-1).id && !runs.at(-1).ref) runs.pop();
  return runs;
}

// —— 属性翻译 ——
const PROP = { facing:'朝向', axis:'轴向', half:'上下', type:'类型', shape:'形状', waterlogged:'含水', hinge:'门轴', part:'部位', hanging:'悬挂', open:'打开', north:'北', south:'南', east:'东', west:'西', up:'上', lit:'点燃', powered:'充能', occupied:'有人', has_book:'有书', signal_fire:'信号烟', distance:'距离', persistent:'不腐烂', attachment:'附着', face:'贴附面', rotation:'旋转', snowy:'积雪', age:'生长' };
const VAL = { north:'北 (−Z)', south:'南 (+Z)', east:'东 (+X)', west:'西 (−X)', up:'上', down:'下', bottom:'下半', top:'上半', upper:'上半', lower:'下半', double:'双层', straight:'直', inner_left:'内角·左', inner_right:'内角·右', outer_left:'外角·左', outer_right:'外角·右', true:'是', false:'否', left:'左', right:'右', head:'床头', foot:'床尾', x:'东西向 (X)', y:'竖直 (Y)', z:'南北向 (Z)', none:'无', low:'矮', tall:'高', floor:'地面', wall:'墙面', ceiling:'天花板' };
const BORING = new Set(['waterlogged','powered','occupied','has_book','signal_fire','distance','persistent']);
export function propText(s, all = false) {
  return Object.entries(s.properties || {})
    .filter(([k, v]) => all || !(BORING.has(k) && (v === 'false' || k === 'distance' || k === 'persistent')))
    .map(([k, v]) => `${PROP[k] ?? k}：${VAL[v] ?? v}`).join(' · ');
}
export function blockNote(s) {
  if (!itemCount(s)) return '自动生成格：随门下半或床尾一起出现，无需单独放置。';
  if (s.name === 'minecraft:lantern' && s.properties.hanging === 'true') return '悬挂灯笼：依附上方方块，主体完成后补装。';
  if (s.name.endsWith('_stairs')) return '楼梯：朝向即玩家放置时面对的方向（高背面在该侧）' + (s.properties.half === 'top' ? '；倒置（贴上半格）。' : '。');
  if (s.name.endsWith('_slab') && s.properties.type !== 'double') return s.properties.type === 'top' ? '上半台阶：点击方块上半部放置。' : '下半台阶。';
  return '';
}
export const shortName = id => id.replace(/^minecraft:/, '');
