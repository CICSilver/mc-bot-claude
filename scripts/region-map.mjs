import { PNG } from 'pngjs';
import { blockAt, selectBounds, surfaceAt } from './region-data.mjs';

// Small bitmap labels keep coordinate maps independent of desktop fonts or a browser.
const FONT = {
  '0':['111','101','101','101','111'], '1':['010','110','010','010','111'], '2':['111','001','111','100','111'],
  '3':['111','001','111','001','111'], '4':['101','101','111','001','001'], '5':['111','100','111','001','111'],
  '6':['111','100','111','101','111'], '7':['111','001','010','010','010'], '8':['111','101','111','101','111'],
  '9':['111','101','111','001','111'], '-':['000','000','111','000','000'], '+':['000','010','111','010','000'],
  'X':['101','101','010','101','101'], 'Y':['101','101','010','010','010'], 'Z':['111','001','010','100','111'],
  'N':['1001','1101','1011','1001','1001'], 'E':['111','100','110','100','111'], 'W':['10001','10001','10101','10101','01010'],
  'S':['111','100','111','001','111'], 'T':['111','010','010','010','010'], 'O':['111','101','101','101','111'],
  'P':['110','101','110','100','100'], 'L':['100','100','100','100','111'], 'I':['111','010','010','010','111'],
  'C':['111','100','100','100','111'], 'H':['101','101','111','101','101'], 'G':['111','100','101','101','111'],
  'D':['110','101','101','101','110'], ':':['000','010','000','010','000'], ' ':['00','00','00','00','00'],
};

export function renderRegionMap(data, selection, { view = 'surface', surface = 'top', y } = {}) {
  const b = selectBounds(data, selection);
  if (view === 'slice' && (!Number.isInteger(y) || y < b.minY || y > b.maxY)) throw new Error('Slice Y must be within the selected height range');
  const w = b.maxX - b.minX + 1, d = b.maxZ - b.minZ + 1;
  const scale = Math.max(1, Math.min(12, Math.floor(640 / Math.max(w, d))));
  const left = 76, top = 44;
  const image = new PNG({ width: Math.max(340, w * scale + left + 90), height: d * scale + top + 62 });
  image.data.fill(255);
  const pixel = (x, z, color) => {
    x = Math.floor(x); z = Math.floor(z);
    if (x < 0 || z < 0 || x >= image.width || z >= image.height) return;
    const i = (z * image.width + x) * 4;
    image.data[i] = color[0]; image.data[i + 1] = color[1]; image.data[i + 2] = color[2]; image.data[i + 3] = 255;
  };
  const text = (label, x, z, color = [30, 36, 40]) => {
    for (const char of String(label)) {
      const glyph = FONT[char] ?? FONT[' '];
      for (let row = 0; row < 5; row++) for (let col = 0; col < glyph[row].length; col++) if (glyph[row][col] === '1') {
        for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) pixel(x + col * 2 + dx, z + row * 2 + dy, color);
      }
      x += (glyph[0].length + 1) * 2;
    }
  };
  const cells = [];
  let low = Infinity, high = -Infinity;
  for (let z = b.minZ; z <= b.maxZ; z++) for (let x = b.minX; x <= b.maxX; x++) {
    const c = view === 'slice' ? blockAt(data, x, y, z) : surfaceAt(data, x, z, { ...b, surface });
    cells.push(c);
    if (c && !c.air) { low = Math.min(low, c.y); high = Math.max(high, c.y); }
  }
  for (let iz = 0; iz < d; iz++) for (let ix = 0; ix < w; ix++) {
    const c = cells[iz * w + ix];
    let color;
    if (!c) color = (ix + iz) % 2 ? [190, 190, 195] : [225, 225, 230];
    else if (c.air) color = [247, 249, 251];
    else if (view === 'height') {
      const t = high === low ? 0.5 : (c.y - low) / (high - low);
      color = [Math.round(40 + t * 195), Math.round(100 + t * 110), Math.round(180 - t * 120)];
    } else {
      const rgb = c.color || (c.name.includes('glass') ? 0xb4dbde : 0xb4a5ba);
      color = [(rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255];
      const north = iz ? cells[(iz - 1) * w + ix] : null;
      const shade = north && c.y != null && north.y != null ? Math.max(0.72, Math.min(1.15, 1 + (c.y - north.y) * 0.06)) : 1;
      color = color.map(v => Math.min(255, Math.round(v * shade)));
    }
    for (let dz = 0; dz < scale; dz++) for (let dx = 0; dx < scale; dx++) pixel(left + ix * scale + dx, top + iz * scale + dz, color);
  }
  const core = data.region.bounds;
  const outline = [220, 55, 110];
  const edge = (x, z) => pixel(left + x, top + z, outline);
  const cx0 = (core.minX - b.minX) * scale, cx1 = (core.maxX - b.minX + 1) * scale - 1;
  const cz0 = (core.minZ - b.minZ) * scale, cz1 = (core.maxZ - b.minZ + 1) * scale - 1;
  for (let x = Math.max(0, cx0); x <= Math.min(w * scale - 1, cx1); x++) {
    if (cz0 >= 0 && cz0 < d * scale) edge(x, cz0);
    if (cz1 >= 0 && cz1 < d * scale) edge(x, cz1);
  }
  for (let z = Math.max(0, cz0); z <= Math.min(d * scale - 1, cz1); z++) {
    if (cx0 >= 0 && cx0 < w * scale) edge(cx0, z);
    if (cx1 >= 0 && cx1 < w * scale) edge(cx1, z);
  }
  text(view === 'slice' ? `SLICE Y:${y}` : view === 'height' ? `HEIGHT Y:${low === Infinity ? '-' : low} ${high === -Infinity ? '-' : high}` : surface === 'solid' ? 'SOLID TOP' : 'TOP', left, 6);
  text('N -Z', image.width - 68, 6);
  text('+X E', image.width - 68, 22);
  const divisions = Math.max(1, Math.min(4, Math.floor(Math.min(w, d) * scale / 90)));
  for (let i = 0; i <= divisions; i++) {
    const x = Math.round(i * (w - 1) / divisions), z = Math.round(i * (d - 1) / divisions);
    text(b.minX + x, left + x * scale, top + d * scale + 10);
    text(b.minZ + z, 2, top + z * scale);
  }
  text('X', left + Math.floor(w * scale / 2), top + d * scale + 30);
  text('Z', 2, 25);
  return PNG.sync.write(image);
}
