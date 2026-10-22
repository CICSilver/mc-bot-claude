// 三维视图：每种方块状态一个 InstancedMesh（实心 + 半透明两套），换层只改实例矩阵，不重建几何。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const M = new THREE.Matrix4(), C = new THREE.Color();
export class Scene3D {
  constructor(container, { onPick, onHover } = {}) {
    this.container = container; this.onPick = onPick; this.onHover = onHover;
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.localClippingEnabled = true;
    container.replaceChildren(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 800);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    Object.assign(this.controls, { enableDamping: true, dampingFactor: 0.12, maxPolarAngle: Math.PI * 0.495, minDistance: 3, maxDistance: 320, screenSpacePanning: true });
    this.controls.addEventListener('change', () => this.dirty = true);
    this.controls.addEventListener('start', () => this.fitted = null);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7f86, 1.55));
    const sun = new THREE.DirectionalLight(0xffffff, 2.0); sun.position.set(-35, 100, -25); this.scene.add(sun);
    this.plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e6);
    this.root = new THREE.Group(); this.scene.add(this.root);
    const box = (color, opacity) => { const h = new THREE.Box3Helper(new THREE.Box3(), color); h.material.depthTest = false; h.material.transparent = true; h.material.opacity = opacity; h.renderOrder = 30; h.visible = false; this.scene.add(h); return h; };
    this.selBox = box(0xd0346c, 1); this.hoverBox = box(0x3d4a6b, 0.7);
    this.layerLines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xc2547a, transparent: true, opacity: 0.55, depthWrite: false }));
    this.layerLines.renderOrder = 5; this.scene.add(this.layerLines);
    this.pools = new Map(); this.geoCache = new Map(); this.ray = new THREE.Raycaster(); this.ptr = new THREE.Vector2();
    this.active = true; this.dirty = true;
    this._bindPointer();
    new ResizeObserver(() => this.resize()).observe(container);
    const loop = () => { requestAnimationFrame(loop); if (!this.active) return; const moved = this.controls.update(); if (moved || this.dirty) { this.renderer.render(this.scene, this.camera); this.dirty = false; } };
    loop();
  }
  _bindPointer() {
    const el = this.renderer.domElement, pointers = new Set(); let down = null, hoverQueued = null;
    el.addEventListener('pointerdown', e => { pointers.add(e.pointerId); down = pointers.size === 1 && e.button === 0 ? { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false } : null; });
    el.addEventListener('pointermove', e => {
      if (down?.id === e.pointerId && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) down.moved = true;
      if (e.pointerType === 'mouse' && !pointers.size) { if (!hoverQueued) requestAnimationFrame(() => { const ev = hoverQueued; hoverQueued = null; this.onHover?.(this.pickAt(ev.clientX, ev.clientY), ev); }); hoverQueued = e; }
    });
    el.addEventListener('pointerleave', () => this.onHover?.(null));
    el.addEventListener('pointerup', e => { const ok = down?.id === e.pointerId && !down.moved && pointers.size === 1; pointers.delete(e.pointerId); down = null; if (ok) this.onPick?.(this.pickAt(e.clientX, e.clientY), e); });
    el.addEventListener('pointercancel', e => { pointers.delete(e.pointerId); down = null; });
  }
  async load(plan) {
    this.plan = plan; this.clearPools(); this.geoCache.forEach(g => g.dispose()); this.geoCache.clear();
    this.terrainMesh && (this.root.remove(this.terrainMesh), this.terrainMesh.geometry.dispose()); this.terrainMesh = null;
    const img = new Image(); img.src = plan.scene.atlas; await img.decode(); this.image = img;
    const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
    const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(img, 0, 0); this.alpha = cx.getImageData(0, 0, cv.width, cv.height).data;
    this.tex?.dispose();
    this.tex = new THREE.Texture(img); Object.assign(this.tex, { colorSpace: THREE.SRGBColorSpace, magFilter: THREE.NearestFilter, minFilter: THREE.NearestFilter, generateMipmaps: false, needsUpdate: true });
    const base = { map: this.tex, vertexColors: true, side: THREE.DoubleSide, clippingPlanes: [this.plane] };
    for (const m of Object.values(this.mats ?? {})) m.dispose();
    this.mats = {
      solid: new THREE.MeshLambertMaterial({ ...base, alphaTest: 0.25 }),
      glass: new THREE.MeshLambertMaterial({ ...base, transparent: true, opacity: 0.6, depthWrite: false, alphaTest: 0.05 }),
      ghost: new THREE.MeshLambertMaterial({ ...base, transparent: true, opacity: 0.2, depthWrite: false, alphaTest: 0.02 }),
      terrain: new THREE.MeshLambertMaterial({ ...base, transparent: true, opacity: 0.14, depthWrite: false, alphaTest: 0.02 }),
    };
    this.dirty = true;
  }
  geometryFor(sid) {
    if (this.geoCache.has(sid)) return this.geoCache.get(sid);
    const s = this.plan.scene.palette[sid], geo = this.plan.scene.geometry[sid];
    const pos = [], uv = [], col = [], tint = new THREE.Color(s.color);
    for (const q of geo?.quads ?? []) {
      const c = q.tint ? tint : { r: 1, g: 1, b: 1 };
      for (const i of [0, 1, 2, 0, 2, 3]) { pos.push(q.p[i * 3], q.p[i * 3 + 1], q.p[i * 3 + 2]); uv.push(q.uv[i * 2], q.uv[i * 2 + 1]); col.push(c.r, c.g, c.b); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals(); g.computeBoundingSphere(); this.geoCache.set(sid, g); return g;
  }
  clearPools() { for (const m of this.pools.values()) { this.root.remove(m); m.dispose(); } this.pools.clear(); }
  _pool(sid, role, need) {
    const k = sid + '|' + role; let m = this.pools.get(k);
    if (m && m.instanceMatrix.count < need) { this.root.remove(m); m.dispose(); m = null; }
    if (!m) {
      const water = this.plan.scene.geometry[sid]?.water;
      const mat = role === 'solid' ? (water ? this.mats.glass : this.mats.solid) : this.mats.ghost;
      m = new THREE.InstancedMesh(this.geometryFor(sid), mat, Math.max(need, 8));
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.setColorAt(0, C.set(1, 1, 1));
      m.renderOrder = role === 'solid' ? 2 : 1; m.frustumCulled = false; m.userData = { role, blocks: [] };
      this.pools.set(k, m); this.root.add(m);
    }
    return m;
  }
  // items: [{block, sid, role:'solid'|'ghost', tint?:[r,g,b]}]
  setItems(items) {
    const groups = new Map();
    for (const it of items) { const k = it.sid + '|' + it.role; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(it); }
    for (const [k, m] of this.pools) if (!groups.has(k)) { m.count = 0; m.userData.blocks = []; }
    for (const [k, list] of groups) {
      const [sid, role] = k.split('|'); const m = this._pool(Number(sid), role, list.length);
      m.userData.blocks = list.map(it => it.block);
      list.forEach((it, i) => { M.makeTranslation(it.block.x, it.block.y, it.block.z); m.setMatrixAt(i, M); m.setColorAt(i, it.tint ? C.setRGB(...it.tint) : C.setRGB(1, 1, 1)); });
      m.count = list.length; m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true;
      m.computeBoundingSphere();
    }
    this.dirty = true;
  }
  setClip(y) { this.plane.constant = y == null ? 1e6 : y + 1.001; this.dirty = true; }
  setLayerOutline(b, y) {
    if (!b) { this.layerLines.visible = false; this.dirty = true; return; }
    const p = [], x0 = b.minX - 1, x1 = b.maxX + 2, z0 = b.minZ - 1, z1 = b.maxZ + 2;
    for (let x = x0; x <= x1; x++) p.push(x, 0, z0, x, 0, z1);
    for (let z = z0; z <= z1; z++) p.push(x0, 0, z, x1, 0, z);
    this.layerLines.geometry.dispose(); this.layerLines.geometry = new THREE.BufferGeometry();
    this.layerLines.geometry.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    this.layerLines.position.y = y + 0.003; this.layerLines.visible = true; this.dirty = true;
  }
  setTerrain(on, isPlanCell) {
    if (on && !this.terrainMesh) this.terrainMesh = this._buildTerrain(isPlanCell);
    if (this.terrainMesh) this.terrainMesh.visible = on; this.dirty = true;
  }
  _buildTerrain(isPlanCell) {
    const d = this.plan.scene, b = d.bounds, nx = b.maxX - b.minX + 1, nz = b.maxZ - b.minZ + 1, ny = b.maxY - b.minY + 1;
    const grid = new Int32Array(nx * ny * nz).fill(-1), at = (x, y, z) => (x < b.minX || x > b.maxX || y < b.minY || y > b.maxY || z < b.minZ || z > b.maxZ) ? -1 : grid[((y - b.minY) * nz + (z - b.minZ)) * nx + (x - b.minX)];
    const cells = [];
    for (let z = b.minZ; z <= b.maxZ; z++) for (let x = b.minX; x <= b.maxX; x++) {
      const r = d.columns[(z - b.minZ) * nx + x - b.minX]; if (!r) continue;
      for (let i = 0; i < r.length; i += 3) { const sid = r[i + 2], s = d.palette[sid]; if (!s || s.air || d.geometry[sid]?.water || !d.geometry[sid]) continue;
        for (let y = Math.max(r[i], b.minY); y <= Math.min(r[i + 1], b.maxY); y++) { if (isPlanCell(x, y, z)) continue; grid[((y - b.minY) * nz + (z - b.minZ)) * nx + (x - b.minX)] = sid; cells.push(x, y, z, sid); } }
    }
    const pos = [], uv = [], col = [];
    for (let i = 0; i < cells.length; i += 4) {
      const x = cells[i], y = cells[i + 1], z = cells[i + 2], sid = cells[i + 3], s = d.palette[sid], tint = new THREE.Color(s.color);
      for (const q of d.geometry[sid].quads) {
        if (q.c) { const n = at(x + q.c[0], y + q.c[1], z + q.c[2]); if (n >= 0 && d.geometry[n]?.opaque) continue; }
        const c = q.tint ? tint : { r: 1, g: 1, b: 1 };
        for (const j of [0, 1, 2, 0, 2, 3]) { pos.push(q.p[j * 3] + x, q.p[j * 3 + 1] + y, q.p[j * 3 + 2] + z); uv.push(q.uv[j * 2], q.uv[j * 2 + 1]); col.push(c.r, c.g, c.b); }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, this.mats.terrain); mesh.renderOrder = 0; this.root.add(mesh); return mesh;
  }
  pickAt(cx, cy) {
    const r = this.renderer.domElement.getBoundingClientRect(); if (!r.width) return null;
    this.ptr.set((cx - r.left) / r.width * 2 - 1, 1 - (cy - r.top) / r.height * 2); this.ray.setFromCamera(this.ptr, this.camera);
    const W = this.image.width, H = this.image.height, clipY = this.plane.constant;
    const ok = h => {
      if (h.point.y > clipY) return false;
      if (!h.uv) return true;
      const x = Math.max(0, Math.min(W - 1, Math.floor(h.uv.x * W))), y = Math.max(0, Math.min(H - 1, Math.floor((1 - h.uv.y) * H)));
      return this.alpha[(y * W + x) * 4 + 3] >= 64;
    };
    // 先找本层实心方块，找不到再找淡显的参照方块（点击参照方块可跳到该层）
    for (const role of ['solid', 'ghost']) {
      const targets = [...this.pools.values()].filter(m => m.count && m.userData.role === role);
      const hit = this.ray.intersectObjects(targets, false).find(ok);
      if (hit) return hit.object.userData.blocks[hit.instanceId];
    }
    return null;
  }
  _box(h, b) { h.visible = !!b; if (b) h.box.set(new THREE.Vector3(b.x - 0.02, b.y - 0.02, b.z - 0.02), new THREE.Vector3(b.x + 1.02, b.y + 1.02, b.z + 1.02)); this.dirty = true; }
  select(b) { this._box(this.selBox, b); }
  hover(b) { this._box(this.hoverBox, b); }
  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight; if (!w || !h) return;
    const changed = this.camera.aspect !== w / h;
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); this.dirty = true;
    if (changed && this.fitted) this._fitCamera(this.fitted.b, this.fitted.y, this.fitted.whole);
  }
  fit(b, y, whole = false) {
    this.resize();
    this.fitted = { b, y, whole };
    this._fitCamera(b, y, whole);
  }
  _fitCamera(b, y, whole) {
    this.controls.target.set((b.minX + b.maxX + 1) / 2, y + 0.5, (b.minZ + b.maxZ + 1) / 2);
    const dx = b.maxX - b.minX + 1, dy = b.maxY - b.minY + 1, dz = b.maxZ - b.minZ + 1;
    const half = Math.atan(Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * Math.min(1, this.camera.aspect));
    const dist = (whole ? Math.hypot(dx, dy, dz) : Math.hypot(dx, dz) * 0.95 + 6) / 2 / Math.sin(half) * 1.05;
    this.camera.position.copy(this.controls.target).add(new THREE.Vector3(-0.7, 0.95, 1).normalize().multiplyScalar(dist));
    this.controls.update(); this.dirty = true;
  }
  followY(dy) { if (!dy || this.fitted?.whole) return; if (this.fitted) this.fitted.y += dy; this.controls.target.y += dy; this.camera.position.y += dy; this.controls.update(); this.dirty = true; }
  zoom(f) { this.fitted = null; this.camera.position.sub(this.controls.target).multiplyScalar(f).add(this.controls.target); this.controls.update(); this.dirty = true; }
  snapshot() { return this.renderer.domElement; }
}
