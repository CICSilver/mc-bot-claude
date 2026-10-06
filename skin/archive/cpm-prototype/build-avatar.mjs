import fs from 'node:fs';
import path from 'node:path';
import { zipSync, strToU8 } from 'fflate';

const out = path.resolve('build');
fs.mkdirSync(out, { recursive: true });
const V = (x = 0, y = 0, z = 0) => ({ x, y, z });
const palette = {
  fur: 'fff1dd', furShade: 'f0dcc5', hair: 'faead4', hairLight: 'fff5e5',
  hairShade: 'e5cdb6', pink: 'eaa3b6', pinkLight: 'f7c4ce', pinkDark: 'bd6c89',
  dress: '483445', dressShade: '372a38', dressLight: '5c4354',
  white: 'fffdf7', whiteShade: 'e5dfe9', gold: 'deb958', goldLight: 'fff09a',
};
let nextId = 100;
const roots = ['head', 'body', 'left_arm', 'right_arm', 'left_leg', 'right_leg'].map(id => ({
  id, name: '', show: false, showInEditor: true, pos: V(), rotation: V(), children: [],
}));
const [head, body, leftArm, rightArm, leftLeg, rightLeg] = roots;
const all = [];
function cube(parent, name, center, size, color, rotation = [0, 0, 0], extra = {}) {
  const e = {
    name, show: true, texture: false, textureSize: 1,
    offset: V(...size.map(n => -n / 2)), pos: V(...center), rotation: V(...rotation),
    size: V(...size), rscale: V(1, 1, 1), scale: V(1, 1, 1),
    u: 0, v: 0, color: palette[color] ?? color, mirror: false, mcScale: 0,
    glow: false, recolor: false, hidden: false, singleTex: false, extrude: false,
    storeID: nextId++, children: [], ...extra,
  };
  parent.children.push(e);
  all.push(e);
  return e;
}
function group(parent, name, center = [0, 0, 0], rotation = [0, 0, 0]) {
  return cube(parent, name, center, [0, 0, 0], 'ffffff', rotation);
}
function rounded(parent, name, center, size, color, bevel = 0.25, rotation = [0, 0, 0]) {
  const g = group(parent, name, center, rotation);
  const [w, h, d] = size;
  cube(g, `${name}.core`, [0, 0, 0], [w, h - bevel * 2, d - bevel * 2], color);
  cube(g, `${name}.vertical`, [0, 0, 0], [w - bevel * 2, h, d - bevel * 2], color);
  cube(g, `${name}.depth`, [0, 0, 0], [w - bevel * 2, h - bevel * 2, d], color);
  return g;
}
function segment(parent, name, a, b, width, depth, color) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const length = Math.hypot(dx, dy, dz);
  const rz = -Math.atan2(dx, Math.hypot(dy, dz)) * 180 / Math.PI;
  const rx = Math.atan2(dz, dy) * 180 / Math.PI;
  return cube(parent, name, a.map((n, i) => (n + b[i]) / 2),
    [width, length + 0.12, depth], color, [rx, 0, rz]);
}
function ribbon(parent, name, p, color, scale = 1, rotation = [0, 0, 0]) {
  const g = group(parent, name, p, rotation);
  cube(g, 'bow.left', [-0.78 * scale, -0.1 * scale, 0], [1.5 * scale, 1.15 * scale, 0.4 * scale], color, [0, 0, -18]);
  cube(g, 'bow.right', [0.78 * scale, -0.1 * scale, 0], [1.5 * scale, 1.15 * scale, 0.4 * scale], color, [0, 0, 18]);
  cube(g, 'bow.knot', [0, 0, -0.22 * scale], [0.55 * scale, 0.7 * scale, 0.45 * scale], color);
  cube(g, 'ribbon.left', [-0.55 * scale, 1.2 * scale, 0.1], [0.62 * scale, 1.9 * scale, 0.2 * scale], color, [0, 0, 18]);
  cube(g, 'ribbon.right', [0.55 * scale, 1.2 * scale, 0.1], [0.62 * scale, 1.9 * scale, 0.2 * scale], color, [0, 0, -18]);
  return g;
}
function ring(parent, name, y, rx, rz, n, size, color, zOffset = 0) {
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2;
    cube(parent, `${name}.${i}`, [Math.sin(a) * rx, y, Math.cos(a) * rz + zOffset],
      size, typeof color === 'function' ? color(i) : color, [0, a * 180 / Math.PI, 0]);
  }
}

// The six vanilla pivots remain intact: walking, looking, swimming and held items
// continue to use normal player animation without changing collision or reach.
rounded(head, 'ivory.face.volume', [0, -4.25, 0], [8.6, 8.2, 7.0], 'fur', 0.42);
cube(head, 'painted.face', [0, -4.25, -3.515], [7.85, 7.55, 0.025], 'ffffff', [0, 0, 0], {
  texture: true,
  faceUV: { north: { sx: 0, sy: 0, ex: 128, ey: 128, rot: '0', autoUV: false } },
});
rounded(head, 'hair.cap', [0, -7.9, 0.45], [9.05, 2.1, 7.65], 'hair', 0.32);
cube(head, 'hair.crown.highlight', [0, -8.98, 0.2], [6.8, 0.24, 6.3], 'hairLight');

// Layered strands keep a readable silhouette instead of one solid hair box.
for (let i = -3; i <= 3; i++) {
  const x = i * 1.05;
  const end = i === 0 ? -3.95 : -4.75 + Math.abs(i) * 0.04;
  const tipX = x + (i < 0 ? 0.25 : -0.25);
  segment(head, `bang.${i}.upper`, [x * 0.7, -8.55, -3.3], [x, -6.65, -3.98], 1.38, 0.72, i % 2 ? 'hair' : 'hairLight');
  segment(head, `bang.${i}.lower`, [x, -6.65, -3.98], [tipX, end, -4.08], 1.05, 0.62, 'hair');
  segment(head, `bang.${i}.tip`, [tipX, end - 0.1, -4.08], [tipX + (i > 0 ? -0.25 : 0.25), end + 0.6, -4.08], 0.47, 0.45, 'hairLight');
}
for (const s of [-1, 1]) {
  const locks = [
    [[s * 3.7, -7.5, -2.8], [s * 4.6, -3.9, -3.2], [s * 4.55, 0.2, -2.9], [s * 3.8, 2.1, -2.8]],
    [[s * 4.0, -6.0, -0.9], [s * 5.0, -1.6, -0.8], [s * 5.3, 2.8, -1.0], [s * 4.5, 5.0, -1.6]],
    [[s * 3.9, -5.0, 1.8], [s * 5.2, -0.2, 1.8], [s * 5.3, 4.6, 2.0], [s * 6.1, 7.0, 1.5]],
  ];
  locks.forEach((points, j) => {
    for (let k = 0; k < points.length - 1; k++) {
      segment(head, `side.lock.${s}.${j}.${k}`, points[k], points[k + 1], 1.7 - k * 0.28, 1.4 - k * 0.18, j % 2 ? 'hairLight' : 'hair');
    }
    const last = points.at(-1);
    segment(head, `side.lock.${s}.${j}.point`, last, [last[0] + s * 0.75, last[1] + 0.55, last[2]], 0.55, 0.65, 'hairLight');
  });
}
const backHair = group(body, 'back.hair.soft.motion', [0, -4.7, 3.0]);
for (let i = -3; i <= 3; i++) {
  const x = i * 1.32;
  const points = [[x * 0.78, -3.1, 0.5], [x, 1.5, 1.3], [x * 1.05, 6, 1.2], [x * 1.18, 11.4 - Math.abs(i) * 0.35, 1.1], [x * 1.05, 14.1 - Math.abs(i) * 0.3, 0.1]];
  for (let k = 0; k < points.length - 1; k++) {
    segment(backHair, `back.lock.${i}.${k}`, points[k], points[k + 1], 2.1 - k * 0.2, 1.8 - k * 0.23, i % 2 ? 'hair' : 'hairLight');
  }
  segment(backHair, `back.lock.${i}.point`, points.at(-1), [x * 1.25, 14.75 - Math.abs(i) * 0.3, -0.1], 0.5, 0.6, 'hair');
}

const earGroups = [];
for (const s of [-1, 1]) {
  const e = group(head, `ear.${s}`, [s * 3.6, -8.4, 0.2], [0, 0, s * 13]);
  earGroups.push(e);
  for (let row = 0; row < 9; row++) {
    const width = 3.85 * (1 - row / 10);
    cube(e, `ear.outer.${row}`, [s * row * 0.035, -row * 0.52, 0], [width, 0.66, 1.35], row % 3 ? 'hairLight' : 'fur');
    if (row > 0 && row < 8) cube(e, `ear.pink.${row}`, [0, -row * 0.52, -0.71], [Math.max(0.15, width - 1.12), 0.57, 0.10], row > 5 ? 'pinkLight' : 'pink');
  }
  for (let j = 0; j < 4; j++) {
    cube(e, `ear.fluff.${j}`, [s * (1.68 - j * 0.10), -0.2 - j * 0.5, -0.18], [0.95, 0.4, 1.05], 'hairLight', [0, 0, s * (20 + j * 8)]);
  }
  ribbon(head, `dark.side.bow.${s}`, [s * 4.7, -5.8, -0.3], 'dress', 0.8, [0, s * -25, s * -15]);
  ribbon(head, `pink.side.ribbon.${s}`, [s * 4.75, -4.75, -1.0], 'pink', 0.48, [0, s * -20, s * -8]);
}
for (let i = 0; i < 13; i++) {
  const angle = -1.12 + i / 12 * 2.24;
  cube(head, `maid.headband.${i}`, [Math.sin(angle) * 4.1, -6.0 - Math.cos(angle) * 3.3, -2.12],
    [0.95, 0.85, 0.55], i % 2 ? 'white' : 'whiteShade', [0, 0, angle * -180 / Math.PI]);
}
const ahoge = group(head, 'ahoge.sway', [0.1, -9.15, 0]);
const curl = [[0, 0, 0], [-0.55, -1.3, 0], [-0.75, -2.7, 0], [-0.1, -3.65, 0], [1.05, -3.8, 0], [1.7, -3.05, 0], [1.45, -2.2, 0]];
for (let i = 0; i < curl.length - 1; i++) segment(ahoge, `curl.${i}`, curl[i], curl[i + 1], Math.max(0.15, 0.37 - i * 0.03), 0.38, 'hairLight');

rounded(body, 'dress.bodice', [0, 3.65, 0], [6.7, 7.2, 4.15], 'dress', 0.22);
cube(body, 'neck.fur', [0, -0.05, 0], [2.7, 1.6, 2.8], 'fur');
cube(body, 'white.collar.left', [-1.0, 0.38, -2.25], [1.75, 1.0, 0.22], 'white', [0, 0, -20]);
cube(body, 'white.collar.right', [1.0, 0.38, -2.25], [1.75, 1.0, 0.22], 'white', [0, 0, 20]);
cube(body, 'bodice.white.center', [0, 4, -2.21], [1.35, 4.75, 0.18], 'white');
for (let y = 2.9; y <= 5.6; y += 1.1) cube(body, 'bodice.button', [0, y, -2.37], [0.25, 0.28, 0.10], 'dressShade');
for (const s of [-1, 1]) {
  for (let i = 0; i < 7; i++) cube(body, `bib.lace.${s}.${i}`, [s * (1.8 - i * 0.09), 1.2 + i * 0.68, -2.27], [0.75, 0.76, 0.32], 'white', [0, 0, s * 8]);
}
ribbon(body, 'pink.neck.bow', [0, 1.55, -2.48], 'pink', 1.05);
rounded(body, 'gold.bell', [0, 1.78, -3.06], [0.85, 0.98, 0.63], 'gold', 0.13);
cube(body, 'bell.shine', [-0.18, 1.57, -3.395], [0.14, 0.32, 0.04], 'goldLight');
cube(body, 'bell.slit', [0, 2.00, -3.395], [0.08, 0.28, 0.04], 'dressShade');

// Tiered radial pleats and a separate apron avoid a rigid rectangular skirt.
for (let tier = 0; tier < 5; tier++) {
  const rx = 3.55 + tier * 0.46, rz = 2.35 + tier * 0.30;
  ring(body, `skirt.pleat.${tier}`, 7.4 + tier * 1.14, rx, rz, 18, [1.8 + tier * 0.12, 1.45, 0.88],
    i => i % 3 === 0 ? 'dressLight' : i % 3 === 1 ? 'dress' : 'dressShade');
}
cube(body, 'waist.front', [0, 6.4, -2.56], [7.45, 1.00, 0.48], 'white');
cube(body, 'waist.back', [0, 6.4, 2.56], [7.45, 1.00, 0.48], 'white');
cube(body, 'waist.left', [3.6, 6.4, 0], [0.48, 1.00, 4.9], 'white');
cube(body, 'waist.right', [-3.6, 6.4, 0], [0.48, 1.00, 4.9], 'white');
ring(body, 'petticoat.white.frill', 12.72, 5.56, 3.73, 28, [1.18, 1.18, 0.9], i => i % 2 ? 'white' : 'whiteShade');
for (let row = 0; row < 8; row++) {
  const t = row / 7;
  const w = 5.1 + Math.sin(t * Math.PI) * 1.25 - t * 1.05;
  const y = 7.2 + row * 0.58, z = -3.40 - row * 0.158;
  cube(body, `apron.front.${row}`, [0, y, z], [w, 0.8, 0.19], 'white');
  for (const s of [-1, 1]) cube(body, `apron.edge.${s}.${row}`, [s * (w / 2 + 0.15), y, z - 0.03], [0.62, 0.71, 0.26], row % 2 ? 'white' : 'whiteShade', [0, 0, s * 16]);
}
for (let i = -3; i <= 3; i++) cube(body, `apron.hem.${i}`, [i * 0.66, 11.73 + (1 - Math.abs(i) / 4) * 0.35, -4.57], [0.84, 0.68, 0.24], 'whiteShade', [0, 0, i * 5]);
for (const s of [-1, 1]) ribbon(body, `skirt.pink.bow.${s}`, [s * 4.35, 9.3, -2.8], 'pink', 0.6, [0, s * -25, s * -9]);
ribbon(body, 'back.waist.bow', [0, 6.4, 4.76], 'white', 1.65, [0, 180, 0]);
cube(body, 'back.long.ribbon.left', [-0.9, 10.4, 4.9], [1.3, 5.0, 0.25], 'whiteShade', [0, 0, 12]);
cube(body, 'back.long.ribbon.right', [0.9, 10.4, 4.9], [1.3, 5.0, 0.25], 'white', [0, 0, -12]);

for (const [root, s] of [[leftArm, 1], [rightArm, -1]]) {
  rounded(root, 'puff.sleeve', [s * 0.2, 0.8, 0], [3.85, 3.7, 4.2], 'dress', 0.32);
  ring(root, 'sleeve.lace', 2.75, 1.58, 1.83, 10, [0.85, 0.75, 0.66], 'white');
  rounded(root, 'forearm.fur', [s * 0.1, 6.1, 0], [2.75, 6.2, 2.9], 'fur', 0.26);
  cube(root, 'forearm.fluff', [s * 1.30, 5.7, 0.2], [0.65, 2.6, 2.15], 'hairLight', [0, 0, s * 12]);
  ring(root, 'wrist.lace', 8.7, 1.27, 1.35, 10, [0.72, 0.72, 0.6], 'white');
  ribbon(root, 'wrist.dark.bow', [0, 8.7, -1.55], 'dress', 0.42);
  rounded(root, 'paw.hand', [s * 0.12, 10.05, -0.2], [3.0, 2.75, 3.0], 'fur', 0.34);
  for (let i = -1; i <= 1; i++) rounded(root, `hand.toe.${i}`, [i * 0.78, 10.85, -0.66], [0.85, 1.0, 1.9], 'hairLight', 0.15);
  ribbon(root, 'sleeve.pink.bow', [s * 0.8, 1.5, -2.0], 'pink', 0.5);
}
for (const [root, s] of [[leftLeg, 1], [rightLeg, -1]]) {
  rounded(root, 'leg.upper.fur', [s * 0.16, 3.2, 0], [3.2, 6.4, 3.35], 'fur', 0.28);
  rounded(root, 'leg.lower.fur', [s * 0.12, 8.0, 0.03], [2.9, 4.7, 3.0], 'fur', 0.25);
  for (let i = 0; i < 3; i++) cube(root, `leg.fluff.${i}`, [s * 1.45, 2.2 + i * 2.4, 0.2], [0.6, 1.35, 2.0], 'hairLight', [0, 0, s * 18]);
  rounded(root, 'paw.foot', [s * 0.18, 10.95, -0.75], [3.5, 2.1, 4.6], 'fur', 0.28);
  for (let i = -1; i <= 1; i++) rounded(root, `foot.toe.${i}`, [s * 0.18 + i * 1.01, 11.18, -2.32], [1.03, 1.55, 1.65], 'hairLight', 0.19);
}

const tail = group(body, 'tail.sway', [0, 8.8, 3.0]);
const tailPoints = [[0, 0, 0], [1.1, 1.2, 2.5], [3.0, 1.5, 4.8], [5.1, 0.0, 6.2], [6.2, -2.8, 6.6], [6.1, -5.8, 6.4], [5.1, -8.0, 6.0], [3.5, -9.1, 5.7]];
for (let i = 0; i < tailPoints.length - 1; i++) {
  const width = [2.2, 3.4, 4.7, 5.7, 5.7, 4.5, 2.8][i];
  const base = segment(tail, `tail.fluff.mass.${i}`, tailPoints[i], tailPoints[i + 1], width, width * 0.83, i % 2 ? 'hairLight' : 'hair');
  for (const s of [-1, 1]) cube(base, `tail.fur.tip.${s}`, [s * width * 0.42, -0.2, 0], [width * 0.4, 1.9, width * 0.6], 'hairLight', [0, 0, s * 22]);
}
segment(tail, 'tail.point', tailPoints.at(-1), [2.1, -9.7, 5.3], 1.2, 1.15, 'hairLight');

const animTargets = [tail, ahoge, backHair, ...earGroups];
const frames = Array.from({ length: 12 }, (_, i) => {
  const p = i / 12 * Math.PI * 2;
  const rot = [
    [Math.sin(p) * 2.3, Math.sin(p) * 7, Math.cos(p) * 1.5],
    [Math.sin(p + 0.4) * 3, 0, Math.sin(p) * 3],
    [Math.sin(p + 1) * 0.85, 0, Math.sin(p) * 0.55],
    [Math.sin(p + 0.7) * 1.2, 0, Math.sin(p) * 1.5],
    [Math.sin(p + 1.3) * 1.2, 0, -Math.sin(p) * 1.5],
  ];
  return { components: animTargets.map((e, j) => ({
    storeID: e.storeID, pos: V(), rotation: V(...rot[j]), scale: V(1, 1, 1), color: 'ffffff', show: true,
  })) };
});
const config = {
  version: 1, skinType: 'default', elements: roots, skinSize: { x: 128, y: 128 },
  textures: { skin: { customGridSize: true, anim: [] } },
  scaling: 0, hideHeadIfSkull: true, removeArmorOffset: true,
  modelId: 'xiaoke-maid-v1', removeBedOffset: false,
};
const description = {
  name: 'Xiaoke - Ivory Maid',
  desc: 'Custom avatar for clawd. Ivory hair and fur, rose eyes, maid dress, animated ears and tail. Local-only cosmetic model; unchanged vanilla collision and controls.',
  cam: { zoom: 96, look: V(0, 6, 0), pos: V(0.8, 0.3, -1), copyProt: 'normal' },
};
const entries = {
  'config.json': strToU8(JSON.stringify(config)),
  'description.json': strToU8(JSON.stringify(description)),
  'skin.png': fs.readFileSync('assets/xiaoke-face.png'),
  'animations/v_global_soft_motion.json': strToU8(JSON.stringify({
    name: 'Soft tail, ears and hair', additive: true, duration: 4200, priority: 0,
    loop: true, interpolator: 'poly_loop', frames,
  })),
};
fs.writeFileSync(path.join(out, 'xiaoke-maid.cpmproject'), zipSync(entries, { level: 9 }));
fs.writeFileSync(path.join(out, 'model.json'), JSON.stringify({ config, description, all }, null, 2));
fs.writeFileSync(path.join(out, 'model-stats.json'), JSON.stringify({
  elements: all.length, visibleCubes: all.filter(e => e.size.x && e.size.y && e.size.z).length,
  texture: { width: 1254, height: 1254, grid: 128 },
  animatedParts: animTargets.map(e => e.name), targetPlayer: 'clawd',
  targetUuid: 'bc9e625b-fdc0-370b-be2e-082f5a6731f6',
}, null, 2));
console.log(`Created ${out}/xiaoke-maid.cpmproject (${all.length} elements).`);
