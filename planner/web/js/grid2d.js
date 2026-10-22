// 二维逐层网格：Canvas 绘制，真实世界 X/Z 坐标，固定在边缘的坐标尺，拖动平移、滚轮/双指缩放。
const DIRS = { east: [1, 0], west: [-1, 0], north: [0, -1], south: [0, 1] };
export class Grid2D {
  constructor(canvas, { onHover, onClick } = {}) {
    this.cv = canvas; this.ctx = canvas.getContext('2d'); this.onHover = onHover; this.onClick = onClick;
    this.data = null; this.size = 20; this.cx = 0; this.cz = 0; this.hover = null; this.queued = false;
    this.margin = { left: 38, top: 24 };
    this.fitted = true;
    this._bind(); new ResizeObserver(() => this.fitted ? this.fit() : this.render()).observe(canvas);
  }
  setData(d, refit = false) { const first = !this.data; this.data = d; if (first || refit) this.fit(); else this.render(); }
  fit() {
    this.fitted = true;
    const d = this.data; if (!d) return; const b = d.bounds, w = this.cv.clientWidth, h = this.cv.clientHeight; if (!w || !h) return;
    const nx = b.maxX - b.minX + 1, nz = b.maxZ - b.minZ + 1;
    this.size = Math.max(3, Math.min(64, Math.min((w - this.margin.left - 16) / nx, (h - this.margin.top - 16) / nz)));
    this.cx = (b.minX + b.maxX + 1) / 2; this.cz = (b.minZ + b.maxZ + 1) / 2;
    this.render();
  }
  // 世界坐标 → 屏幕
  sx(x) { const w = this.cv.clientWidth; return (w + this.margin.left) / 2 + (x - this.cx) * this.size; }
  sz(z) { const h = this.cv.clientHeight; return (h + this.margin.top) / 2 + (z - this.cz) * this.size; }
  cellAt(px, py) { const w = this.cv.clientWidth, h = this.cv.clientHeight; return { x: Math.floor(this.cx + (px - (w + this.margin.left) / 2) / this.size), z: Math.floor(this.cz + (py - (h + this.margin.top) / 2) / this.size) }; }
  zoomBy(f, px, py) {
    this.fitted = false;
    const w = this.cv.clientWidth, h = this.cv.clientHeight; px ??= (w + this.margin.left) / 2; py ??= (h + this.margin.top) / 2;
    const wx = this.cx + (px - (w + this.margin.left) / 2) / this.size, wz = this.cz + (py - (h + this.margin.top) / 2) / this.size;
    this.size = Math.max(3, Math.min(96, this.size * f));
    this.cx = wx - (px - (w + this.margin.left) / 2) / this.size; this.cz = wz - (py - (h + this.margin.top) / 2) / this.size;
    this.render();
  }
  centerOn(x, z) { this.fitted = false; this.cx = x + 0.5; this.cz = z + 0.5; this.render(); }
  setHover(c) { this.hover = c; this.render(); }
  render() { if (this.queued) return; this.queued = true; requestAnimationFrame(() => { this.queued = false; this._draw(); }); }
  drawNow() { this.queued = false; this._draw(); }
  _bind() {
    const cv = this.cv, pts = new Map(); let down = null, pinch = null;
    const local = e => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    cv.addEventListener('pointerdown', e => {
      cv.setPointerCapture(e.pointerId); pts.set(e.pointerId, local(e));
      if (pts.size === 1) down = { id: e.pointerId, ...local(e), cx: this.cx, cz: this.cz, moved: false, type: e.pointerType };
      else { down = null; const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }; }
    });
    cv.addEventListener('pointermove', e => {
      const p = local(e);
      if (pts.has(e.pointerId)) pts.set(e.pointerId, p);
      if (pts.size === 2 && pinch) {
        const [a, b] = [...pts.values()], d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        this.cx -= (mx - pinch.mx) / this.size; this.cz -= (my - pinch.my) / this.size;
        this.zoomBy(d / pinch.d, mx, my); pinch = { d, mx, my }; return;
      }
      if (down?.id === e.pointerId) {
        const dx = p.x - down.x, dy = p.y - down.y;
        if (Math.hypot(dx, dy) > (down.type === 'mouse' ? 4 : 8)) down.moved = true;
        if (down.moved) { this.fitted = false; this.cx = down.cx - dx / this.size; this.cz = down.cz - dy / this.size; this.render(); cv.style.cursor = 'grabbing'; }
        return;
      }
      if (e.pointerType === 'mouse') { const c = this.cellAt(p.x, p.y), inside = p.x > this.margin.left && p.y > this.margin.top; this._hover(inside ? c : null, e); }
    });
    const end = e => {
      const wasClick = down?.id === e.pointerId && !down.moved && pts.size === 1;
      pts.delete(e.pointerId); if (pts.size < 2) pinch = null; cv.style.cursor = '';
      if (wasClick) { const p = local(e); if (p.x > this.margin.left && p.y > this.margin.top) this.onClick?.(this.cellAt(p.x, p.y), e); }
      down = null;
    };
    cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', e => { pts.delete(e.pointerId); down = null; pinch = null; });
    cv.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') this._hover(null, e); });
    cv.addEventListener('wheel', e => { e.preventDefault(); const p = local(e); this.zoomBy(Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0015)), p.x, p.y); }, { passive: false });
    cv.addEventListener('dblclick', e => { if (e.shiftKey || this.noDblZoom?.()) return; const p = local(e); this.zoomBy(1.6, p.x, p.y); });
  }
  _hover(c, e) {
    const same = c && this.hover && c.x === this.hover.x && c.z === this.hover.z;
    if (!same && (c || this.hover)) { this.hover = c; this.render(); }
    this.onHover?.(c, e);
  }
  _draw() {
    const cv = this.cv, ctx = this.ctx, d = this.data; const w = cv.clientWidth, h = cv.clientHeight; if (!w || !h || !d) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.imageSmoothingEnabled = false; ctx.clearRect(0, 0, w, h);
    const T = d.theme, s = this.size, b = d.bounds, ML = this.margin.left, MT = this.margin.top;
    // 可见范围（世界坐标）
    const tl = this.cellAt(ML, MT), br = this.cellAt(w, h);
    const x0 = Math.max(b.minX - 6, tl.x - 1), x1 = Math.min(b.maxX + 6, br.x + 1), z0 = Math.max(b.minZ - 6, tl.z - 1), z1 = Math.min(b.maxZ + 6, br.z + 1);
    const vis = (x, z) => x >= x0 && x <= x1 && z >= z0 && z <= z1;
    ctx.save(); ctx.beginPath(); ctx.rect(ML, MT, w - ML, h - MT); ctx.clip();
    // 建筑范围底色
    ctx.fillStyle = T.plot; ctx.fillRect(this.sx(b.minX), this.sz(b.minZ), (b.maxX - b.minX + 1) * s, (b.maxZ - b.minZ + 1) * s);
    const cell = (x, z, sid, alpha) => {
      const px = this.sx(x), pz = this.sz(z); ctx.globalAlpha = alpha;
      if (d.texture) ctx.drawImage(d.sprite(sid), px, pz, s, s); else { ctx.fillStyle = d.flat(sid); ctx.fillRect(px, pz, s, s); }
      ctx.globalAlpha = 1;
    };
    // 现有地形（本层）
    if (d.terrain?.length) {
      for (const t of d.terrain) if (vis(t.x, t.z)) cell(t.x, t.z, t.sid, 0.28);
      ctx.strokeStyle = T.hatch; ctx.lineWidth = 1; ctx.beginPath();
      for (const t of d.terrain) if (vis(t.x, t.z) && s >= 8) { const px = this.sx(t.x), pz = this.sz(t.z); ctx.moveTo(px, pz + s); ctx.lineTo(px + s, pz); }
      ctx.stroke();
    }
    // 下层虚影
    for (const g of d.ghost) if (vis(g.b.x, g.b.z)) cell(g.b.x, g.b.z, g.sid, d.ghostAlpha ?? 0.2);
    // 本层其他章节
    for (const o of d.others) if (vis(o.b.x, o.b.z)) cell(o.b.x, o.b.z, o.sid, 0.32);
    // 本层
    for (const it of d.layer) {
      const { b: bl } = it; if (!vis(bl.x, bl.z)) continue;
      cell(bl.x, bl.z, it.sid, it.muted ? 0.18 : 1);
    }
    // 网格线
    const line = (style, width, test) => {
      ctx.strokeStyle = style; ctx.lineWidth = width; ctx.beginPath();
      for (let x = x0; x <= x1 + 1; x++) if (test(x)) { const p = Math.round(this.sx(x)) + (width % 2 ? 0.5 : 0); ctx.moveTo(p, MT); ctx.lineTo(p, h); }
      for (let z = z0; z <= z1 + 1; z++) if (test(z)) { const p = Math.round(this.sz(z)) + (width % 2 ? 0.5 : 0); ctx.moveTo(ML, p); ctx.lineTo(w, p); }
      ctx.stroke();
    };
    const mod = (a, n) => ((a % n) + n) % n;
    if (s >= 5) line(T.grid1, 1, v => mod(v, 5) && mod(v, 16));
    line(T.grid5, s >= 10 ? 1.5 : 1, v => !mod(v, 5) && mod(v, 16));
    line(T.grid16, 2, v => !mod(v, 16));
    // 方块细节：朝向、半砖、已放置、其他章节虚线
    if (s >= 12) for (const it of d.layer) { if (vis(it.b.x, it.b.z) && !it.muted) this._glyph(it, T); }
    for (const o of d.others) if (vis(o.b.x, o.b.z) && s >= 8) { ctx.strokeStyle = T.other; ctx.setLineDash([3, 3]); ctx.lineWidth = 1; ctx.strokeRect(this.sx(o.b.x) + 1.5, this.sz(o.b.z) + 1.5, s - 3, s - 3); ctx.setLineDash([]); }
    for (const it of d.layer) if (it.done && vis(it.b.x, it.b.z)) {
      const px = this.sx(it.b.x), pz = this.sz(it.b.z); ctx.fillStyle = T.doneFill; ctx.fillRect(px, pz, s, s);
      if (s >= 10) { ctx.strokeStyle = T.done; ctx.lineWidth = Math.max(1.5, s / 10); ctx.beginPath(); ctx.moveTo(px + s * .25, pz + s * .52); ctx.lineTo(px + s * .43, pz + s * .7); ctx.lineTo(px + s * .76, pz + s * .3); ctx.stroke(); }
    }
    // 标记：准备事项、扩建接口、桩位
    for (const m of d.marks || []) if (vis(m.x, m.z)) {
      const px = this.sx(m.x), pz = this.sz(m.z); ctx.strokeStyle = m.color; ctx.lineWidth = 2;
      if (m.type === 'prep') { ctx.beginPath(); ctx.moveTo(px + 3, pz + 3); ctx.lineTo(px + s - 3, pz + s - 3); ctx.moveTo(px + s - 3, pz + 3); ctx.lineTo(px + 3, pz + s - 3); ctx.stroke(); }
      else { ctx.beginPath(); ctx.arc(px + s / 2, pz + s / 2, Math.max(3, s * 0.42), 0, Math.PI * 2); ctx.stroke(); }
    }
    // 选中与悬停
    if (d.filterRow != null) { ctx.fillStyle = T.rowFill; }
    if (this.hover) {
      const { x, z } = this.hover; ctx.fillStyle = T.cross; ctx.fillRect(ML, this.sz(z), w, s); ctx.fillRect(this.sx(x), MT, s, h);
      ctx.strokeStyle = T.hover; ctx.lineWidth = 2; ctx.strokeRect(this.sx(x) + 1, this.sz(z) + 1, s - 2, s - 2);
    }
    if (d.selected) { const { x, z } = d.selected; ctx.strokeStyle = T.sel; ctx.lineWidth = 3; ctx.strokeRect(this.sx(x) - 0.5, this.sz(z) - 0.5, s + 1, s + 1); }
    ctx.restore();
    // 坐标尺（固定在上/左）
    ctx.fillStyle = T.ruler; ctx.fillRect(0, 0, w, MT); ctx.fillRect(0, 0, ML, h);
    ctx.strokeStyle = T.grid5; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(ML + .5, MT); ctx.lineTo(ML + .5, h); ctx.moveTo(ML, MT + .5); ctx.lineTo(w, MT + .5); ctx.stroke();
    const step = s >= 26 ? 1 : s >= 13 ? 2 : s >= 6 ? 5 : 10;
    ctx.font = `${s >= 26 ? 11 : 10}px ui-monospace, SFMono-Regular, Menlo, monospace`; ctx.textBaseline = 'middle';
    ctx.save(); ctx.beginPath(); ctx.rect(ML, 0, w - ML, MT); ctx.clip(); ctx.textAlign = 'center';
    for (let x = x0; x <= x1; x++) if (!mod(x, step)) { const bold = !mod(x, 16) || !mod(x, 5); ctx.fillStyle = !mod(x, 16) ? T.grid16 : bold ? T.label : T.labelDim; ctx.font = `${bold ? 600 : 400} ${s >= 26 ? 11 : 10}px ui-monospace, Menlo, monospace`; ctx.fillText(String(x), this.sx(x) + s / 2, MT / 2 + 1); }
    if (this.hover) { const px = this.sx(this.hover.x); ctx.fillStyle = T.hover; ctx.fillRect(px, MT - 3, s, 3); }
    ctx.restore();
    ctx.save(); ctx.beginPath(); ctx.rect(0, MT, ML, h - MT); ctx.clip(); ctx.textAlign = 'right';
    for (let z = z0; z <= z1; z++) if (!mod(z, step)) { const bold = !mod(z, 16) || !mod(z, 5); ctx.fillStyle = !mod(z, 16) ? T.grid16 : bold ? T.label : T.labelDim; ctx.font = `${bold ? 600 : 400} ${s >= 26 ? 11 : 10}px ui-monospace, Menlo, monospace`; ctx.fillText(String(z), ML - 5, this.sz(z) + s / 2 + 1); }
    if (this.hover) { const pz = this.sz(this.hover.z); ctx.fillStyle = T.hover; ctx.fillRect(ML - 3, pz, 3, s); }
    ctx.restore();
    ctx.fillStyle = T.labelDim; ctx.font = '600 10px system-ui'; ctx.textAlign = 'center'; ctx.fillText('Z↓ X→', ML / 2 + 1, MT / 2 + 1);
  }
  _glyph(it, T) {
    const ctx = this.ctx, s = this.size, st = it.s, p = st.properties || {}, px = this.sx(it.b.x), pz = this.sz(it.b.z), cx = px + s / 2, cz = pz + s / 2;
    ctx.lineWidth = Math.max(1.4, s / 14); ctx.strokeStyle = T.glyph; ctx.fillStyle = T.glyph;
    const badge = (txt) => { const fs = Math.max(8, Math.min(13, s * 0.36)); ctx.font = `700 ${fs}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; const tw = ctx.measureText(txt).width + 4; ctx.fillStyle = T.badgeBg; ctx.fillRect(px + s - tw - 1, pz + s - fs - 2, tw, fs + 2); ctx.fillStyle = T.badge; ctx.fillText(txt, px + s - tw / 2 - 1, pz + s - fs / 2 - 1); };
    const n = st.name;
    if (n.endsWith('_stairs') && DIRS[p.facing]) {
      const [dx, dz] = DIRS[p.facing], L = s * 0.3;
      ctx.beginPath(); ctx.moveTo(cx - dx * L, cz - dz * L); ctx.lineTo(cx + dx * L, cz + dz * L);
      ctx.moveTo(cx + dx * L, cz + dz * L); ctx.lineTo(cx + dx * L * 0.3 - dz * L * 0.55, cz + dz * L * 0.3 + dx * L * 0.55);
      ctx.moveTo(cx + dx * L, cz + dz * L); ctx.lineTo(cx + dx * L * 0.3 + dz * L * 0.55, cz + dz * L * 0.3 - dx * L * 0.55); ctx.stroke();
      if (p.half === 'top') badge('倒'); else if (p.shape && p.shape !== 'straight') badge(p.shape.startsWith('inner') ? '内' : '外');
    } else if (n.endsWith('_slab')) badge(p.type === 'top' ? '上' : p.type === 'double' ? '双' : '下');
    else if (n.endsWith('_trapdoor')) { badge(p.open === 'true' ? '开' : p.half === 'top' ? '上' : '下'); this._edge(p.facing, px, pz, T); }
    else if (n.endsWith('_door')) { badge(p.half === 'upper' ? '门上' : '门'); this._edge(p.facing, px, pz, T); }
    else if (n.endsWith('_bed')) { badge(p.part === 'head' ? '头' : '尾'); this._edge(p.facing, px, pz, T); }
    else if (p.axis && (n.includes('log') || n.includes('wood') || n.includes('stem') || n.includes('pillar') || n.includes('basalt') || n.includes('chain') || n.endsWith('_block') || n.includes('bamboo'))) {
      if (p.axis === 'y') { ctx.beginPath(); ctx.arc(cx, cz, s * 0.12, 0, Math.PI * 2); ctx.stroke(); }
      else { ctx.beginPath(); if (p.axis === 'x') { ctx.moveTo(px + s * .18, cz); ctx.lineTo(px + s * .82, cz); } else { ctx.moveTo(cx, pz + s * .18); ctx.lineTo(cx, pz + s * .82); } ctx.stroke(); }
    } else if (n === 'minecraft:lantern' || n.endsWith('_lantern')) badge(p.hanging === 'true' ? '吊' : '灯');
    else if (DIRS[p.facing]) this._edge(p.facing, px, pz, T);
    if (it.auto) { ctx.strokeStyle = T.auto; ctx.setLineDash([2, 2]); ctx.lineWidth = 1.2; ctx.strokeRect(px + 2, pz + 2, s - 4, s - 4); ctx.setLineDash([]); }
  }
  _edge(facing, px, pz, T) {
    const d = DIRS[facing]; if (!d) return; const s = this.size, ctx = this.ctx, cx = px + s / 2, cz = pz + s / 2, [dx, dz] = d;
    const tx = cx + dx * s * 0.42, tz = cz + dz * s * 0.42, k = s * 0.16;
    ctx.fillStyle = T.glyph; ctx.beginPath(); ctx.moveTo(tx, tz); ctx.lineTo(tx - dx * k - dz * k, tz - dz * k - dx * k); ctx.lineTo(tx - dx * k + dz * k, tz - dz * k + dx * k); ctx.closePath(); ctx.fill();
  }
}
