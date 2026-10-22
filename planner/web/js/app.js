import { Scene3D } from './scene3d.js';
import { Grid2D } from './grid2d.js';
import { Ruler } from './ruler.js';
import { keyOf, ALL, validatePlan, stateId, stateOf, itemCount, indexPlan, boundsOf, materialRows, lineRuns, propText, blockNote, stackText, shortName } from './plan.js';

const $ = id => document.getElementById(id);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const VIEWS = ['plan', 'split', '3d'], DISPLAYS = ['single', 'below', 'full'];
const wide = () => matchMedia('(min-width: 900px)').matches;

// ---------- 状态 ----------
const S = { plan: null, chapter: null, y: null, palette: 'cherry', view: wide() ? 'split' : 'plan', display: 'below', clip: true, terrain: false, texture: true, scope: 'layer', tab: 'materials', placeMode: false };
let catalog, catalogURL, plan, idx, filterBlocks = [], layers = [], fb, cur = [], selected = null, matFilter = null, hoverCell = null;
let doneLayers = new Set(), placed = new Set(), loadSeq = 0;
const spriteCache = new Map(), urlCache = new Map();

// ---------- 小工具 ----------
function icons(root = document) { for (const el of $$('i[data-icon]', root)) el.dataset.lucide = el.dataset.icon; window.lucide.createIcons(); }
function el(tag, attrs = {}, ...kids) { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v); } e.append(...kids.flat().filter(k => k != null && k !== false)); return e; }
let toastTimer; function toast(t) { const n = $('toast'); n.textContent = t; n.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => n.classList.remove('show'), 2600); }
const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
function fail(e) { console.error(e); const n = $('error'); n.hidden = false; n.textContent = '出错了：' + (e?.message ?? e); }

// ---------- 进度存储（兼容旧版 key） ----------
const doneKey = () => `mc-planner:done:${plan.id}:${plan.revision}:${S.palette}`;
const placedKey = () => `mc-planner:placed:${plan.id}:${plan.revision}:${S.palette}`;
function readProgress() {
  try { doneLayers = new Set(JSON.parse(localStorage.getItem(doneKey()) ?? '[]')); } catch { doneLayers = new Set(); }
  try { placed = new Set(JSON.parse(localStorage.getItem(placedKey()) ?? '[]')); } catch { placed = new Set(); }
}
function writeProgress() { try { localStorage.setItem(doneKey(), JSON.stringify([...doneLayers])); localStorage.setItem(placedKey(), JSON.stringify([...placed])); } catch { toast('无法保存进度（浏览器禁止本地存储）'); } }
const isDone = b => doneLayers.has(`${b.chapter}:${b.y}`) || placed.has(keyOf(b));
function chapterLayerBlocks(ch, y) { return (idx.byY.get(y) ?? []).filter(b => b.chapter === ch); }
function setPlaced(b, on) {
  const lk = `${b.chapter}:${b.y}`;
  if (on) { placed.add(keyOf(b)); if (chapterLayerBlocks(b.chapter, b.y).every(o => placed.has(keyOf(o)))) doneLayers.add(lk); }
  else { if (doneLayers.has(lk)) { doneLayers.delete(lk); for (const o of chapterLayerBlocks(b.chapter, b.y)) placed.add(keyOf(o)); } placed.delete(keyOf(b)); }
  writeProgress();
}
function layerChapters() { return [...new Set(cur.map(b => b.chapter))]; }
function layerIsDone() { return cur.length > 0 && cur.every(isDone); }
function toggleLayerDone() {
  const on = !layerIsDone();
  for (const ch of layerChapters()) { const k = `${ch}:${S.y}`; if (on) doneLayers.add(k); else doneLayers.delete(k); }
  if (!on) for (const b of cur) placed.delete(keyOf(b));
  writeProgress(); toast(on ? `Y=${S.y} 已标记完成` : `Y=${S.y} 已取消完成`); refresh({ keepView: true });
}

// ---------- URL / 偏好 ----------
function saveURL() {
  const u = new URL(location.href), p = u.searchParams;
  p.set('plan', S.plan); p.set('chapter', S.chapter); p.set('y', S.y); p.set('palette', S.palette); p.set('view', S.view); p.set('display', S.display);
  S.clip ? p.delete('clip') : p.set('clip', '0'); S.terrain ? p.set('terrain', '1') : p.delete('terrain');
  selected ? p.set('sel', `${selected.x},${selected.z}`) : p.delete('sel');
  history.replaceState(null, '', u);
  try { localStorage.setItem('mc-planner:v2:view', JSON.stringify({ plan: S.plan, chapter: S.chapter, y: S.y, palette: S.palette, view: S.view, display: S.display, clip: S.clip, terrain: S.terrain, texture: S.texture, scope: S.scope }));
    localStorage.setItem('mc-planner:view', JSON.stringify({ plan: S.plan, chapter: S.chapter, y: S.y, palette: S.palette, view: S.view === 'split' ? 'plan' : S.view, display: S.display })); } catch {}
}
function readInitial() {
  const q = new URLSearchParams(location.search); let saved = {}, old = {};
  try { saved = JSON.parse(localStorage.getItem('mc-planner:v2:view') ?? '{}'); } catch {}
  try { old = JSON.parse(localStorage.getItem('mc-planner:view') ?? '{}'); } catch {}
  const pick = k => q.get(k) ?? saved[k] ?? old[k];
  S.plan = pick('plan') ?? null;
  // 本地记忆的章节 / 层只在同一方案时沿用
  const mem = [saved, old].find(o => o.plan === S.plan) ?? {};
  S.chapter = q.get('chapter') ?? mem.chapter ?? null; S.palette = q.get('palette') ?? mem.palette ?? saved.palette ?? S.palette;
  const y = Number(q.get('y') ?? mem.y); S.y = q.has('y') || mem.y != null ? (Number.isFinite(y) ? y : null) : null;
  const v = q.get('view') ?? saved.view ?? old.view; if (VIEWS.includes(v)) S.view = v;
  const d = q.get('display') ?? saved.display ?? old.display; if (DISPLAYS.includes(d)) S.display = d;
  if (q.has('clip')) S.clip = q.get('clip') !== '0'; else if (typeof saved.clip === 'boolean') S.clip = saved.clip;
  if (q.has('terrain')) S.terrain = q.get('terrain') === '1'; else if (typeof saved.terrain === 'boolean') S.terrain = saved.terrain;
  if (typeof saved.texture === 'boolean') S.texture = saved.texture;
  if (['layer', 'chapter', 'all'].includes(saved.scope)) S.scope = saved.scope;
  const sel = q.get('sel')?.split(',').map(Number); S.initialSel = sel?.length === 2 && sel.every(Number.isInteger) ? sel : null;
  S.explicitPlan = q.has('plan') || !!saved.plan || !!old.plan;
}

// ---------- 主题 ----------
let T2, TR;
function readTheme() {
  const v = n => cssVar('--' + n);
  T2 = { plot: v('plot'), grid1: v('grid1'), grid5: v('grid5'), grid16: v('grid16'), ruler: v('ruler-bg'), label: v('ink'), labelDim: v('muted'), hover: v('ai'), cross: v('cross'), sel: v('accent'), glyph: v('glyph'), badge: v('badge'), badgeBg: v('badge-bg'), other: v('other'), auto: v('auto'), done: v('done'), doneFill: v('done-fill'), hatch: v('hatch'), rowFill: v('cross') };
  TR = { curBand: v('accent-soft'), hoverBand: v('soft'), bar: v('bar'), barCur: v('accent'), barDone: v('done'), empty: v('line'), label: v('ink'), labelDim: v('muted'), labelCur: v('accent') };
}
function applyTheme(pref) {
  const dark = pref === 'dark' || (pref === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'; readTheme();
  if (plan) { draw2D(); drawRuler(); }
}
let themePref = (() => { try { return localStorage.getItem('mc-planner:v2:theme') || 'auto'; } catch { return 'auto'; } })();

// ---------- 方块贴图 ----------
function sprite(sid) {
  if (spriteCache.has(sid)) return spriteCache.get(sid);
  const geo = plan.scene.geometry[sid], img = scene.image, c = document.createElement('canvas'); c.width = c.height = 16;
  const cx = c.getContext('2d'); cx.imageSmoothingEnabled = false;
  const area = q => { const u = q.uv.filter((_, i) => i % 2 === 0), v = q.uv.filter((_, i) => i % 2 === 1); return (Math.max(...u) - Math.min(...u)) * (Math.max(...v) - Math.min(...v)); };
  const quads = geo?.quads ?? [], ups = quads.filter(q => q.c?.[1] === 1 || (q.p[1] === q.p[4] && q.p[4] === q.p[7] && q.p[1] > 0.4));
  let q = ups.sort((a, b) => area(b) - area(a))[0];
  if (!q || area(q) < area(quads.slice().sort((a, b) => area(b) - area(a))[0] ?? q) * 0.3) q = quads.slice().sort((a, b) => area(b) - area(a))[0];
  if (q) {
    const u = q.uv.filter((_, i) => i % 2 === 0), v = q.uv.filter((_, i) => i % 2 === 1);
    cx.drawImage(img, Math.min(...u) * img.width, (1 - Math.max(...v)) * img.height, Math.max(1, (Math.max(...u) - Math.min(...u)) * img.width), Math.max(1, (Math.max(...v) - Math.min(...v)) * img.height), 0, 0, 16, 16);
    if (q.tint) { cx.globalCompositeOperation = 'multiply'; cx.fillStyle = flat(sid); cx.fillRect(0, 0, 16, 16); cx.globalCompositeOperation = 'destination-in'; cx.drawImage(img, Math.min(...u) * img.width, (1 - Math.max(...v)) * img.height, Math.max(1, (Math.max(...u) - Math.min(...u)) * img.width), Math.max(1, (Math.max(...v) - Math.min(...v)) * img.height), 0, 0, 16, 16); cx.globalCompositeOperation = 'source-over'; }
  } else { cx.fillStyle = flat(sid); cx.fillRect(0, 0, 16, 16); }
  spriteCache.set(sid, c); return c;
}
const spriteURL = sid => { if (!urlCache.has(sid)) urlCache.set(sid, sprite(sid).toDataURL()); return urlCache.get(sid); };
const flat = sid => '#' + (plan.scene.palette[sid]?.color ?? 0x888888).toString(16).padStart(6, '0');

// ---------- 视图对象 ----------
const scene = new Scene3D($('scene'), {
  onPick: (b, e) => b ? clickBlock(b, e) : null,
  onHover: (b, e) => { scene.hover(b); if (b && e) showTip(b, e.clientX, e.clientY); else hideTip(); },
});
const grid = new Grid2D($('grid'), {
  onHover: (c, e) => { hoverCell = c; if (!c) { hideTip(); scene.hover(null); return; } const info = cellInfo(c.x, c.z); scene.hover(info.block ? { x: c.x, y: S.y, z: c.z } : null); showCellTip(c, info, e.clientX, e.clientY); },
  onClick: (c, e) => { const info = cellInfo(c.x, c.z); if (info.block && info.mine) clickBlock(info.block, e); else { selected = { x: c.x, y: S.y, z: c.z }; afterSelect(); } },
});
grid.noDblZoom = () => S.placeMode;
const ruler = new Ruler($('ruler'), { onSelect: y => setLayer(y), onStep: d => step(d) });

// ---------- 计算 ----------
function computeFilter() {
  filterBlocks = S.chapter === ALL ? plan.blocks : plan.blocks.filter(b => b.chapter === S.chapter);
  layers = [...new Set(filterBlocks.map(b => b.y))].sort((a, b) => a - b);
  fb = boundsOf(filterBlocks);
}
const inFilter = b => S.chapter === ALL || b.chapter === S.chapter;
function cellInfo(x, z) {
  const b = idx.byKey.get(`${x},${S.y},${z}`);
  const below = idx.byKey.get(`${x},${S.y - 1},${z}`);
  return { block: b, mine: b && inFilter(b), below, terrain: terrainAt(x, S.y, z) };
}
// 地形快照：scene.columns 为 X 优先的竖向 RLE
function terrainAt(x, y, z) {
  const d = plan.scene, b = d.bounds; if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) return null;
  const r = d.columns[(z - b.minZ) * (b.maxX - b.minX + 1) + x - b.minX]; if (!r) return null;
  for (let i = 0; i < r.length; i += 3) if (y >= r[i] && y <= r[i + 1]) { const s = d.palette[r[i + 2]]; return s && !s.air ? { sid: r[i + 2], s } : null; }
  return null;
}
function priorChapters() { if (S.chapter === ALL) return null; const i = idx.chapterIndex.get(S.chapter); return new Set(plan.chapters.slice(0, i + 1).map(c => c.id)); }

// ---------- 绘制 ----------
function draw2D(refit = false) {
  const sid = b => stateId(plan, b, S.palette);
  const layer = cur.map(b => { const s = plan.scene.palette[sid(b)]; return { b, sid: sid(b), s, done: isDone(b), muted: matFilter && s.name !== matFilter, auto: !itemCount(s) }; });
  const atY = idx.byY.get(S.y) ?? [], prior = priorChapters();
  const others = S.display === 'single' ? [] : atY.filter(b => !inFilter(b) && (S.display === 'full' || !prior || prior.has(b.chapter))).map(b => ({ b, sid: sid(b) }));
  const ghost = S.display === 'single' ? [] : (idx.byY.get(S.y - 1) ?? []).map(b => ({ b, sid: sid(b) }));
  const terrain = [];
  if (S.terrain) { const tb = plan.scene.bounds; for (let z = Math.max(tb.minZ, fb.minZ - 6); z <= Math.min(tb.maxZ, fb.maxZ + 6); z++) for (let x = Math.max(tb.minX, fb.minX - 6); x <= Math.min(tb.maxX, fb.maxX + 6); x++) { if (idx.byKey.has(`${x},${S.y},${z}`)) continue; const t = terrainAt(x, S.y, z); if (t && !plan.scene.geometry[t.sid]?.water) terrain.push({ x, z, sid: t.sid }); } }
  const marks = [];
  for (const p of plan.preparation) if (p.y === S.y) marks.push({ x: p.x, z: p.z, type: 'prep', color: cssVar('--warn') });
  for (const p of plan.expansionPorts) if (p.position?.[1] === S.y) marks.push({ x: p.position[0], z: p.position[2], type: 'port', color: cssVar('--ai') });
  grid.setData({ bounds: fb, layer, ghost, others, terrain, marks, selected: selected && selected.y === S.y ? selected : null, texture: S.texture, sprite, flat, theme: T2, ghostAlpha: S.display === 'full' ? 0.16 : 0.22 }, refit);
}
function draw3D() {
  const items = [], sid = b => stateId(plan, b, S.palette), prior = priorChapters();
  for (const b of cur) {
    const s = plan.scene.palette[sid(b)], muted = matFilter && s.name !== matFilter;
    items.push({ block: b, sid: sid(b), role: muted ? 'ghost' : 'solid', tint: isDone(b) ? [0.72, 1, 0.74] : null });
  }
  if (S.display !== 'single') {
    for (const b of plan.blocks) {
      if (b.y === S.y && inFilter(b)) continue;
      if (S.display === 'below' && (b.y >= S.y + (inFilter(b) ? 0 : 1) || (prior && !prior.has(b.chapter)))) continue;
      items.push({ block: b, sid: sid(b), role: 'ghost' });
    }
  }
  scene.setItems(items);
  scene.setClip(S.clip ? S.y : null);
  scene.setLayerOutline(fb, S.y);
  scene.select(selected);
  $('tag3d').innerHTML = `<b>三维</b> ${S.clip ? `剖切于 Y=${S.y}` : '未剖切'} · ${{ single: '仅本层', below: '含下层', full: '全部结构' }[S.display]}`;
}
function drawRuler() {
  const counts = new Map();
  for (const b of filterBlocks) { const c = counts.get(b.y) ?? { total: 0, done: 0 }; c.total++; if (isDone(b)) c.done++; counts.set(b.y, c); }
  ruler.set({ minY: fb.minY, maxY: fb.maxY, layers, counts, current: S.y, theme: TR });
}
function drawHeader() {
  const i = layers.indexOf(S.y), done = cur.filter(isDone).length;
  $('yinput').value = S.y; $('yinput').min = layers[0]; $('yinput').max = layers.at(-1);
  $('layer-index').textContent = `第 ${i + 1} / ${layers.length} 层`;
  $('layer-sub').textContent = `${cur.length} 格 · 已放 ${done}`;
  $('down').disabled = i <= 0; $('up').disabled = i >= layers.length - 1;
  const ld = layerIsDone(); $('layer-done').classList.toggle('on', ld); $('layer-done').querySelector('span').textContent = ld ? '本层已完成' : '本层完成';
  $$('button[data-view]').forEach(b => b.setAttribute('aria-pressed', b.dataset.view === S.view));
  $$('button[data-display]').forEach(b => b.setAttribute('aria-pressed', b.dataset.display === S.display));
  $('clip').setAttribute('aria-pressed', S.clip); $('terrain').setAttribute('aria-pressed', S.terrain); $('texture').setAttribute('aria-pressed', S.texture); $('place-mode').setAttribute('aria-pressed', S.placeMode);
  const eff = effectiveView(); $('views').dataset.view = eff; scene.active = eff !== 'plan';
  document.body.dataset.y = S.y; document.body.dataset.chapter = S.chapter; document.body.dataset.plan = S.plan;
}
const effectiveView = () => S.view === 'split' && !wide() ? 'plan' : S.view;

function drawMaterials() {
  const blocks = S.scope === 'layer' ? cur : S.scope === 'chapter' ? filterBlocks : plan.blocks;
  const rows = materialRows(plan, blocks, S.palette, isDone), items = rows.reduce((n, r) => n + r.items, 0), left = rows.reduce((n, r) => n + r.left, 0), auto = rows.reduce((n, r) => n + r.automatic, 0);
  const scopeName = { layer: `Y=${S.y}${S.chapter === ALL ? '' : ' · ' + chapterTitle(S.chapter)}`, chapter: S.chapter === ALL ? '全部章节' : chapterTitle(S.chapter), all: '整个方案' }[S.scope];
  $('mat-summary').textContent = `${scopeName}：共 ${items} 件 · ${rows.length} 种${left !== items ? ` · 还需 ${left} 件` : ''}${auto ? ` · 自动生成 ${auto} 格` : ''}`;
  $$('button[data-scope]').forEach(b => b.setAttribute('aria-pressed', b.dataset.scope === S.scope));
  $('materials').replaceChildren(...rows.map(r => {
    const st = stackText(r.left, r.id), finished = r.items > 0 && r.left === 0;
    return el('button', { class: 'mat' + (finished ? ' finished' : ''), 'aria-pressed': matFilter === r.id, title: `${r.id}\n点击在图中高亮`, onclick: () => { matFilter = matFilter === r.id ? null : r.id; drawMaterials(); draw2D(); draw3D(); } },
      el('img', { src: spriteURL(r.state), alt: '' }),
      el('span', { class: 'mname' }, r.name, el('small', {}, shortName(r.id) + (r.automatic ? ` · 含 ${r.automatic} 格自动` : ''))),
      el('span', { class: 'mqty' }, r.items ? (r.left !== r.items ? el('b', {}, String(r.left)) : el('b', {}, String(r.items))) : '自动', r.left !== r.items && r.items ? el('small', {}, `/ ${r.items}`) : null, st ? el('small', { class: 'stack' }, st) : null));
  }));
  $('clear-filter').hidden = !matFilter;
  return rows;
}
const chapterTitle = id => plan.chapters.find(c => c.id === id)?.title ?? id;

function drawProgress() {
  const bar = (id, a, b) => { $(id).style.width = pct(a, b) + '%'; $(id + '-t').textContent = `${pct(a, b)}%`; $(id + '-t').title = `${a} / ${b} 格`; };
  bar('p-layer', cur.filter(isDone).length, cur.length);
  bar('p-chapter', filterBlocks.filter(isDone).length, filterBlocks.length);
  const all = plan.blocks.filter(isDone).length; bar('p-all', all, plan.blocks.length);
  $('overall-bar').style.width = pct(all, plan.blocks.length) + '%'; $('overall-text').textContent = `${pct(all, plan.blocks.length)}% · ${all}/${plan.blocks.length}`;
  $('chapters').replaceChildren(...plan.chapters.map((c, i) => {
    const bl = plan.blocks.filter(b => b.chapter === c.id), d = bl.filter(isDone).length, ys = [...new Set(bl.map(b => b.y))], dl = ys.filter(y => bl.filter(b => b.y === y).every(isDone)).length;
    return el('button', { class: 'chap' + (c.id === S.chapter ? ' on' : ''), onclick: () => selectChapter(c.id) },
      el('span', { class: 'cn' }, `${i + 1}. ${c.title}`), el('span', { class: 'cm' }, `${dl}/${ys.length} 层 · ${pct(d, bl.length)}%`), el('div', { class: 'meter' }, el('i', { style: `width:${pct(d, bl.length)}%` })));
  }));
}

function drawInspector() {
  const box = $('inspector');
  if (!selected) { box.replaceChildren(el('span', { class: 'muted' }, '未选中方块')); return; }
  const b = idx.byKey.get(keyOf(selected)), mine = b && inFilter(b);
  const head = el('div', { class: 'ins-head' });
  if (b) {
    const sid = stateId(plan, b, S.palette), s = plan.scene.palette[sid];
    head.append(el('img', { src: spriteURL(sid), alt: '' }), el('div', {}, el('b', {}, s.displayName || s.name, !mine ? el('span', { class: 'tag' }, '其他章节') : null), el('span', { class: 'coord' }, `X ${b.x} · Y ${b.y} · Z ${b.z}`), el('small', {}, `${shortName(s.name)} · ${chapterTitle(b.chapter)}`)));
    const props = propText(s), note = blockNote(s);
    const done = isDone(b);
    if (mine) head.append(el('button', { class: 'btn chip' + (done ? ' on-done' : ''), onclick: () => { setPlaced(b, !done); refresh({ keepView: true }); } }, done ? '✓ 已放置' : '标记已放置'));
    box.replaceChildren(head, props ? el('div', { class: 'props' }, props) : '', note ? el('div', { class: 'muted small' }, note) : '');
  } else {
    const t = terrainAt(selected.x, S.y, selected.z);
    box.replaceChildren(el('div', { class: 'ins-head' }, el('div', {}, el('b', {}, '留空（方案中无方块）'), el('span', { class: 'coord' }, `X ${selected.x} · Y ${S.y} · Z ${selected.z}`), t ? el('small', {}, `现有地形：${t.s.displayName || t.s.name}`) : null)));
  }
  // 本行 / 本列连续段
  const runsFor = axis => { const fixed = axis === 'x' ? selected.z : selected.x; const others = (idx.byY.get(S.y) ?? []).filter(o => !inFilter(o)); return { fixed, runs: lineRuns(plan, S.palette, cur, others, axis, fixed, axis === 'x' ? fb.minX : fb.minZ, axis === 'x' ? fb.maxX : fb.maxZ) }; };
  for (const axis of ['x', 'z']) {
    const { fixed, runs } = runsFor(axis); if (!runs.length) continue;
    box.append(el('div', { class: 'runs' }, el('span', { class: 'rl' }, axis === 'x' ? `Z=${fixed} 行（西→东 X ${runs[0].start}…${runs.at(-1).end}）` : `X=${fixed} 列（北→南 Z ${runs[0].start}…${runs.at(-1).end}）`),
      ...runs.map(r => el('span', { class: r.id ? 'run' : r.ref ? 'run ref' : 'run gap', title: `${axis.toUpperCase()} ${r.start}…${r.end}` }, `${r.name} ${r.count}`))));
  }
}

// ---------- 提示框 ----------
const tip = $('tip');
function placeTip(x, y) { const r = tip.getBoundingClientRect(); let L = x + 16, Tt = y + 16; if (L + r.width > innerWidth - 8) L = x - r.width - 12; if (Tt + r.height > innerHeight - 8) Tt = y - r.height - 12; tip.style.transform = `translate(${Math.max(4, L)}px, ${Math.max(4, Tt)}px)`; }
function showTip(b, x, y) {
  const sid = stateId(plan, b, S.palette), s = plan.scene.palette[sid];
  tip.replaceChildren(el('div', { class: 'tt-head' }, el('img', { src: spriteURL(sid), alt: '' }), el('b', {}, s.displayName || s.name)), el('div', { class: 'coord' }, `X ${b.x}  Y ${b.y}  Z ${b.z}`), propText(s) ? el('div', { class: 'small' }, propText(s)) : '', el('div', { class: 'small muted' }, chapterTitle(b.chapter) + (isDone(b) ? ' · ✓ 已放置' : '')));
  tip.hidden = false; placeTip(x, y);
}
function showCellTip(c, info, x, y) {
  if (info.block) { showTip(info.block, x, y); if (!info.mine) tip.append(el('div', { class: 'small warn' }, '其他章节（参照）')); }
  else {
    const kids = [el('div', { class: 'coord' }, `X ${c.x}  Y ${S.y}  Z ${c.z}`), el('div', { class: 'small muted' }, '留空')];
    if (info.terrain) kids.push(el('div', { class: 'small' }, `现有地形：${info.terrain.s.displayName || info.terrain.s.name}`));
    if (info.below) kids.push(el('div', { class: 'small muted' }, `下层：${stateOf(plan, info.below, S.palette).displayName}`));
    tip.replaceChildren(...kids); tip.hidden = false;
  }
  if (selected && (selected.x !== c.x || selected.z !== c.z)) tip.append(el('div', { class: 'small delta' }, `距选中 ΔX ${c.x - selected.x >= 0 ? '+' : ''}${c.x - selected.x} · ΔZ ${c.z - selected.z >= 0 ? '+' : ''}${c.z - selected.z}`));
  const p = plan.preparation.find(p => p.x === c.x && p.y === S.y && p.z === c.z); if (p) tip.append(el('div', { class: 'small warn' }, `⚠ ${p.reason}`));
  placeTip(x, y);
}
function hideTip() { tip.hidden = true; }

// ---------- 交互 ----------
function clickBlock(b, e) {
  if (b.y !== S.y && !(e?.shiftKey)) { if (!layers.includes(b.y)) selectChapter(b.chapter); setLayer(b.y); }
  const mine = inFilter(b) && b.y === S.y;
  if (mine && (S.placeMode || e?.shiftKey)) { setPlaced(b, !isDone(b)); selected = { x: b.x, y: b.y, z: b.z }; refresh({ keepView: true }); return; }
  selected = { x: b.x, y: b.y, z: b.z }; afterSelect();
}
function afterSelect() { drawInspector(); draw2D(); scene.select(selected && idx.byKey.has(keyOf(selected)) ? selected : null); saveURL(); }
function refresh({ fit = false, keepView = false } = {}) {
  cur = (idx.byY.get(S.y) ?? []).filter(inFilter);
  if (selected && selected.y !== S.y) selected = { ...selected, y: S.y };
  drawHeader(); drawRuler(); draw2D(fit); draw3D(); drawMaterials(); drawProgress(); drawInspector();
  if (fit) fitAll(); saveURL();
}
function fitAll() { const whole = S.display === 'full' && !S.clip, b = whole ? boundsOf(plan.blocks) : fb; scene.fit(b, whole ? (b.minY + b.maxY) / 2 : S.y, whole); grid.fit(); }
function setLayer(y) {
  if (!layers.length) return;
  const ny = layers.reduce((best, n) => Math.abs(n - y) < Math.abs(best - y) ? n : best, layers[0]);
  if (ny === S.y) return; const dy = ny - S.y; S.y = ny; scene.followY(dy); refresh({ keepView: true });
}
function step(d) { const i = layers.indexOf(S.y); const n = layers[Math.max(0, Math.min(layers.length - 1, i + d))]; if (n != null) setLayer(n); }
function selectChapter(id) {
  S.chapter = id; $('chapter').value = id; matFilter = null; computeFilter();
  const y = S.y; S.y = layers.includes(y) ? y : layers.reduce((best, n) => Math.abs(n - y) < Math.abs(best - y) ? n : best, layers[0]);
  refresh({ fit: true });
  const note = plan.chapters.find(c => c.id === id)?.note; $('chapter-note').textContent = id === ALL ? '显示全部章节的方块。' : note || '';
}
function setView(v) { S.view = v; drawHeader(); requestAnimationFrame(() => { scene.resize(); grid.fit(); if (effectiveView() !== 'plan') fitAll(); }); saveURL(); }
function setDisplay(d) { S.display = d; refresh({ keepView: true }); }

// ---------- 方案加载 ----------
async function loadPlan(id, initial = false) {
  const seq = ++loadSeq, entry = catalog.plans.find(p => p.id === id) ?? catalog.plans.find(p => p.id === catalog.defaultPlan) ?? catalog.plans[0];
  $('plan').disabled = true; document.body.dataset.ready = 'false';
  const src = new URL(entry.url, catalogURL), res = await fetch(src); if (!res.ok) throw Error('方案加载失败：HTTP ' + res.status);
  const next = validatePlan(await res.json()); if (seq !== loadSeq) return;
  plan = next; idx = indexPlan(plan); S.plan = plan.id; spriteCache.clear(); urlCache.clear(); selected = null; matFilter = null;
  await scene.load(plan); scene.setTerrain(false, () => false);
  $('title').textContent = plan.title; document.title = plan.title + ' · 逐层建造'; $('plan').value = entry.id;
  fillSelect($('chapter'), [[ALL, '全部章节'], ...plan.chapters.map((c, i) => [c.id, `${i + 1}. ${c.title}`])]);
  fillSelect($('palette'), plan.palettes.map(p => [p.id, p.title]));
  if (!plan.palettes.some(p => p.id === S.palette)) S.palette = plan.palettes[0].id; $('palette').value = S.palette;
  $('palette-wrap').classList.toggle('single', plan.palettes.length < 2);
  readProgress(); drawInfo(src);
  const ch = initial && (S.chapter === ALL || plan.chapters.some(c => c.id === S.chapter)) ? S.chapter : plan.defaultChapter ?? plan.chapters[0].id;
  if (!initial) S.y = null;
  S.chapter = ch; $('chapter').value = ch; computeFilter();
  S.y = S.y != null && layers.includes(S.y) ? S.y : S.y != null ? layers.reduce((best, n) => Math.abs(n - S.y) < Math.abs(best - S.y) ? n : best, layers[0]) : layers[0];
  if (initial && S.initialSel) selected = { x: S.initialSel[0], y: S.y, z: S.initialSel[1] };
  if (S.terrain) scene.setTerrain(true, (x, y, z) => idx.byKey.has(`${x},${y},${z}`));
  $('chapter-note').textContent = ch === ALL ? '显示全部章节的方块。' : plan.chapters.find(c => c.id === ch)?.note || '';
  refresh({ fit: true }); if (selected) grid.centerOn(selected.x, selected.z);
  $('plan').disabled = false; document.body.dataset.ready = 'true';
}
function fillSelect(sel, rows) { sel.replaceChildren(...rows.map(([v, t]) => el('option', { value: v }, t))); }
function nameOf(id) { const s = plan.scene.palette.find(p => p.name === id); return s?.displayName ? `${s.displayName}` : shortName(id ?? ''); }
function drawInfo(src) {
  const jump = (x, y, z) => { const b = idx.byKey.get(`${x},${y},${z}`); if (b && !inFilter(b)) selectChapter(b.chapter); else if (!layers.includes(y)) selectChapter(ALL); S.y = y; selected = { x, y, z }; refresh({ keepView: true }); grid.centerOn(x, z); if (S.view === '3d') setView(wide() ? 'split' : 'plan'); };
  const item = (title, sub, on) => el('button', { class: 'li', onclick: on }, el('span', {}, title), el('small', {}, sub));
  $('n-prep').textContent = plan.preparation.length; $('d-prep').hidden = !plan.preparation.length;
  $('prep').replaceChildren(...plan.preparation.map(p => item(p.reason, `X ${p.x} · Y ${p.y} · Z ${p.z}${p.before ? ` · ${nameOf(p.before)} → ${nameOf(p.after)}` : ''}`, () => jump(p.x, p.y, p.z))));
  $('n-supports').textContent = plan.supports.length; $('d-supports').hidden = !plan.supports.length;
  $('supports').replaceChildren(...plan.supports.map(p => item(`X ${p.x} · Z ${p.z} · ${p.width}×${p.width}`, `柱顶 Y=${p.top} · 柱长 ${p.top - p.groundMax}～${p.top - p.groundMin} 格（湖底 Y ${p.groundMin}${p.groundMax !== p.groundMin ? '～' + p.groundMax : ''}）`, () => jump(p.x, p.top, p.z))));
  $('n-ports').textContent = plan.expansionPorts.length; $('d-ports').hidden = !plan.expansionPorts.length;
  const face = { west: '朝西', east: '朝东', north: '朝北', south: '朝南' };
  $('ports').replaceChildren(...plan.expansionPorts.map(p => item(p.title, `X ${p.position[0]} · Y ${p.position[1]} · Z ${p.position[2]} · ${face[p.facing] ?? p.facing}`, () => jump(...p.position))));
  const links = [['overview', '整体预览（旧版总览）'], ['cherryMaterials', '樱花版完整材料清单'], ['originalMaterials', '原配色完整材料清单']].filter(([k]) => plan.resources?.[k]);
  const legacy = new URL('./legacy.html', location.href); legacy.searchParams.set('plan', plan.id);
  $('resources').replaceChildren(...links.map(([k, t]) => el('a', { class: 'li', href: new URL(plan.resources[k], src).href, target: '_blank', rel: 'noopener' }, el('span', {}, t), el('small', {}, plan.resources[k]))), el('a', { class: 'li', href: legacy.href }, el('span', {}, '简版逐层视图'), el('small', {}, 'legacy.html')));
  $('overview').hidden = !plan.resources?.overview; if (plan.resources?.overview) $('overview').href = new URL(plan.resources.overview, src).href;
  $('snapshot').textContent = `场地快照 ${String(plan.captured).replace('T', ' ').slice(0, 19)} UTC · 版本 ${plan.revision} · ${plan.blocks.length} 格`;
}

// ---------- 事件绑定 ----------
$('plan').addEventListener('change', () => loadPlan($('plan').value).catch(fail));
$('chapter').addEventListener('change', () => selectChapter($('chapter').value));
$('palette').addEventListener('change', () => { S.palette = $('palette').value; spriteCache.clear(); urlCache.clear(); readProgress(); refresh({ keepView: true }); });
$('up').addEventListener('click', () => step(1)); $('down').addEventListener('click', () => step(-1));
$('yinput').addEventListener('change', () => { const y = $('yinput').valueAsNumber; if (Number.isFinite(y)) setLayer(y); else $('yinput').value = S.y; });
$('layer-done').addEventListener('click', toggleLayerDone);
$$('button[data-view]').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
$$('button[data-display]').forEach(b => b.addEventListener('click', () => setDisplay(b.dataset.display)));
$('clip').addEventListener('click', () => { S.clip = !S.clip; drawHeader(); draw3D(); saveURL(); });
$('terrain').addEventListener('click', () => { S.terrain = !S.terrain; scene.setTerrain(S.terrain, (x, y, z) => idx.byKey.has(`${x},${y},${z}`)); drawHeader(); draw2D(); saveURL(); });
$('texture').addEventListener('click', () => { S.texture = !S.texture; drawHeader(); draw2D(); saveURL(); });
$('place-mode').addEventListener('click', () => { S.placeMode = !S.placeMode; drawHeader(); toast(S.placeMode ? '勾选模式：点击方块标记 / 取消已放置' : '已退出勾选模式'); });
const zoom = f => { if (effectiveView() === '3d') scene.zoom(1 / f); else grid.zoomBy(f); };
$('zoom-in').addEventListener('click', () => zoom(1.25)); $('zoom-out').addEventListener('click', () => zoom(0.8)); $('fit').addEventListener('click', fitAll);
$$('button[data-scope]').forEach(b => b.addEventListener('click', () => { S.scope = b.dataset.scope; drawMaterials(); saveURL(); }));
$('clear-filter').addEventListener('click', () => { matFilter = null; drawMaterials(); draw2D(); draw3D(); });
$('copy-materials').addEventListener('click', async () => {
  const blocks = S.scope === 'layer' ? cur : S.scope === 'chapter' ? filterBlocks : plan.blocks, rows = materialRows(plan, blocks, S.palette, isDone);
  const text = `${plan.title} · ${$('mat-summary').textContent}\n` + rows.filter(r => r.items).map(r => `${r.name}（${shortName(r.id)}）× ${r.left}${r.left !== r.items ? ` / ${r.items}` : ''}${stackText(r.left, r.id) ? `（${stackText(r.left, r.id)}）` : ''}`).join('\n');
  try { await navigator.clipboard.writeText(text); toast('材料清单已复制'); } catch { toast('复制失败，浏览器不允许访问剪贴板'); }
});
$$('button[data-tab]').forEach(b => b.addEventListener('click', () => { S.tab = b.dataset.tab; $$('button[data-tab]').forEach(t => t.setAttribute('aria-selected', t === b)); $$('[data-panel]').forEach(p => p.hidden = p.dataset.panel !== S.tab); }));
$('clear-layer').addEventListener('click', () => { for (const ch of layerChapters()) doneLayers.delete(`${ch}:${S.y}`); for (const b of cur) placed.delete(keyOf(b)); writeProgress(); toast(`已清除 Y=${S.y} 的完成记录`); refresh({ keepView: true }); });
$('share').addEventListener('click', async () => { saveURL(); try { await navigator.clipboard.writeText(location.href); toast('链接已复制（不含本机进度）'); } catch { prompt('复制此链接：', location.href); } });
$('theme').addEventListener('click', () => { themePref = { auto: 'light', light: 'dark', dark: 'auto' }[themePref]; try { localStorage.setItem('mc-planner:v2:theme', themePref); } catch {} applyTheme(themePref); toast({ auto: '主题：跟随系统', light: '主题：浅色', dark: '主题：深色' }[themePref]); });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => themePref === 'auto' && applyTheme('auto'));
matchMedia('(min-width: 900px)').addEventListener('change', () => plan && setView(S.view));

let digits = '', digitTimer;
const commitDigits = () => { if (digits) { const y = Number(digits); digits = ''; setLayer(y); } };
document.addEventListener('keydown', e => {
  if (!plan || e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target; if (t.matches?.('input, select, textarea')) return;
  const k = e.key;
  if (/^[0-9]$/.test(k)) { digits += k; toast(`跳到 Y=${digits}…（Enter 确认）`); clearTimeout(digitTimer); digitTimer = setTimeout(commitDigits, 900); e.preventDefault(); return; }
  if (k === 'Enter' && digits) { clearTimeout(digitTimer); commitDigits(); e.preventDefault(); return; }
  const map = { ArrowUp: () => step(1), w: () => step(1), W: () => step(1), PageUp: () => step(1), ArrowDown: () => step(-1), s: () => step(-1), S: () => step(-1), PageDown: () => step(-1),
    Home: () => setLayer(layers[0]), End: () => setLayer(layers.at(-1)),
    v: () => { const list = wide() ? VIEWS : ['plan', '3d'], i = list.indexOf(effectiveView()); setView(list[(i + 1) % list.length]); }, m: () => setDisplay(DISPLAYS[(DISPLAYS.indexOf(S.display) + 1) % 3]),
    c: () => $('clip').click(), t: () => $('terrain').click(), d: () => toggleLayerDone(), f: fitAll, '+': () => zoom(1.25), '=': () => zoom(1.25), '-': () => zoom(0.8),
    ' ': () => { const b = selected && idx.byKey.get(keyOf(selected)); if (b && inFilter(b)) { setPlaced(b, !isDone(b)); refresh({ keepView: true }); } },
    Escape: () => { selected = null; matFilter = null; refresh({ keepView: true }); } };
  const fn = map[k] ?? map[k.toLowerCase?.()]; if (fn) { e.preventDefault(); fn(); }
});
window.addEventListener('popstate', () => location.reload());

// ---------- 启动 ----------
(async () => {
  try {
    icons(); readTheme(); readInitial();
    catalogURL = new URL(document.querySelector('meta[name=mc-catalog]')?.content || './plans/index.json', location.href);
    const res = await fetch(catalogURL); if (!res.ok) throw Error('方案目录加载失败：HTTP ' + res.status);
    catalog = await res.json(); if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.plans) || !catalog.plans.length) throw Error('方案目录格式无效');
    if (!S.explicitPlan || !catalog.plans.some(p => p.id === S.plan)) S.plan = catalog.defaultPlan;
    fillSelect($('plan'), catalog.plans.map(p => [p.id, p.title]));
    await loadPlan(S.plan, true);
  } catch (e) { fail(e); }
})();
// 便于调试/自动测试
window.__mc = { get state() { return { ...S, layers: [...layers], selected, current: cur.length }; }, setLayer, step, selectChapter, setView, loadPlan, grid, scene };
