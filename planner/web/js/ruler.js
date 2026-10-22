// 竖向 Y 层尺：每层一行，带方块数小直方图与完成度；点击/拖动跳层，滚轮逐层。
export class Ruler {
  constructor(canvas, { onSelect, onStep } = {}) {
    this.cv = canvas; this.ctx = canvas.getContext('2d'); this.onSelect = onSelect; this.onStep = onStep; this.hoverY = null; this.data = null;
    new ResizeObserver(() => this.draw()).observe(canvas);
    let dragging = false;
    const pick = e => { const y = this.yAt(e); if (y != null) this.onSelect?.(y); };
    canvas.addEventListener('pointerdown', e => { dragging = true; canvas.setPointerCapture(e.pointerId); pick(e); });
    canvas.addEventListener('pointermove', e => { if (dragging) pick(e); else { const y = this.rowAt(e); if (y !== this.hoverY) { this.hoverY = y; this.draw(); } } });
    const stop = () => { dragging = false; };
    canvas.addEventListener('pointerup', stop); canvas.addEventListener('pointercancel', stop);
    canvas.addEventListener('pointerleave', () => { if (this.hoverY != null) { this.hoverY = null; this.draw(); } });
    let acc = 0;
    canvas.addEventListener('wheel', e => { e.preventDefault(); acc += e.deltaMode ? e.deltaY * 30 : e.deltaY; while (Math.abs(acc) >= 40) { this.onStep?.(acc < 0 ? 1 : -1); acc -= Math.sign(acc) * 40; } }, { passive: false });
  }
  set(data) { this.data = data; this.draw(); }
  geom() { const d = this.data, h = this.cv.clientHeight, n = d.maxY - d.minY + 1, pad = 10; return { n, pad, rh: (h - pad * 2) / n }; }
  rowAt(e) {
    if (!this.data) return null; const r = this.cv.getBoundingClientRect(), { n, pad, rh } = this.geom();
    const i = Math.floor((e.clientY - r.top - pad) / rh); if (i < 0 || i >= n) return null; return this.data.maxY - i;
  }
  yAt(e) {
    // 拖到空层时吸附到最近的有方块层
    const d = this.data; if (!d) return null; const r = this.cv.getBoundingClientRect(), { n, pad, rh } = this.geom();
    const raw = d.maxY - Math.max(0, Math.min(n - 1, Math.floor((e.clientY - r.top - pad) / rh)));
    return d.layers.reduce((best, y) => Math.abs(y - raw) < Math.abs(best - raw) ? y : best, d.layers[0]);
  }
  draw() {
    const d = this.data, cv = this.cv, ctx = this.ctx, w = cv.clientWidth, h = cv.clientHeight; if (!d || !w || !h) return;
    const dpr = Math.min(devicePixelRatio || 1, 2); cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    const T = d.theme, { n, pad, rh } = this.geom(), LW = 30, bx = LW + 4, bw = w - bx - 6;
    const max = Math.max(1, ...[...d.counts.values()].map(c => c.total));
    const labelEvery = rh >= 12 ? 1 : rh >= 5 ? 5 : 10;
    ctx.textBaseline = 'middle'; ctx.textAlign = 'right';
    for (let i = 0; i < n; i++) {
      const y = d.maxY - i, top = pad + i * rh, c = d.counts.get(y), cur = y === d.current, hov = y === this.hoverY;
      if (cur) { ctx.fillStyle = T.curBand; ctx.fillRect(0, top - 1, w, rh + 2); }
      else if (hov) { ctx.fillStyle = T.hoverBand; ctx.fillRect(0, top, w, rh); }
      const gap = rh > 6 ? 1.5 : rh > 3 ? 0.75 : 0;
      if (c?.total) {
        const len = Math.max(2, bw * Math.sqrt(c.total / max));
        ctx.fillStyle = cur ? T.barCur : T.bar; ctx.fillRect(bx, top + gap, len, rh - gap * 2);
        if (c.done) { ctx.fillStyle = T.barDone; ctx.fillRect(bx, top + gap, len * c.done / c.total, rh - gap * 2); }
        if (c.done === c.total && rh >= 9) { ctx.fillStyle = T.barDone; ctx.font = `700 ${Math.min(11, rh)}px system-ui`; ctx.textAlign = 'left'; ctx.fillText('✓', Math.min(bx + len + 3, w - 10), top + rh / 2 + 0.5); ctx.textAlign = 'right'; }
      } else if (rh >= 4) { ctx.fillStyle = T.empty; ctx.fillRect(bx, top + rh / 2 - 0.5, 6, 1); }
      if ((cur || hov) && c?.total && rh >= 8) {
        const len = Math.max(2, bw * Math.sqrt(c.total / max)), txt = c.done ? `${c.done}/${c.total}` : String(c.total);
        ctx.font = `600 ${Math.min(11, rh)}px system-ui`; const tw = ctx.measureText(txt).width;
        const tx = bx + len + 3 + tw <= w - 8 ? bx + len + 3 : bx + 3;
        ctx.textAlign = 'left'; ctx.fillStyle = tx === bx + 3 ? '#fff' : T.label; ctx.fillText(txt, tx, top + rh / 2 + 0.5); ctx.textAlign = 'right';
      }
      if (cur || hov || y % labelEvery === 0) {
        ctx.font = `${cur ? 700 : y % 5 === 0 ? 600 : 400} ${cur ? 12 : 10}px ui-monospace, Menlo, monospace`;
        ctx.fillStyle = cur ? T.labelCur : c?.total ? T.label : T.labelDim;
        if (!cur && (d.current - y) !== 0 && Math.abs(d.current - y) * rh < 12 && labelEvery > 1) continue;
        ctx.fillText(String(y), LW, top + rh / 2 + 0.5);
      }
    }
    // 当前层指针
    const ci = d.maxY - d.current, cy = pad + ci * rh + rh / 2;
    ctx.fillStyle = T.labelCur; ctx.beginPath(); ctx.moveTo(w, cy); ctx.lineTo(w - 6, cy - 5); ctx.lineTo(w - 6, cy + 5); ctx.closePath(); ctx.fill();
  }
}
