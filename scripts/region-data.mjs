import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';

const execute = promisify(execFile);

export function regionTransport(env = process.env) {
  const base = new URL(env.REGION_URL ?? 'http://127.0.0.1:25620');
  if (!['127.0.0.1', 'localhost'].includes(base.hostname) || base.protocol !== 'http:') {
    throw new Error('REGION_URL must be a loopback HTTP address');
  }
  return async (path, params = {}, method = 'GET') => {
    const url = new URL(path, base);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    let data;
    if (env.REGION_SSH_HOST) {
      // Only fixed endpoint names and URL-encoded parameters reach the remote shell.
      const command = `curl --noproxy '*' --silent --show-error --fail-with-body --compressed --max-time 180 -X ${method} -H 'Content-Type: application/json' '${url.href.replaceAll("'", '%27')}'`;
      try {
        const result = await execute(env.REGION_SSH_BIN ?? 'ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', env.REGION_SSH_HOST, command],
          { windowsHide: true, timeout: 190_000, maxBuffer: 128 * 1024 * 1024 });
        data = JSON.parse(result.stdout);
      } catch (error) {
        let remote;
        try { remote = JSON.parse(error.stdout ?? '{}').error; } catch { /* Connection error has no JSON body. */ }
        throw new Error(remote ?? `Region connection failed: ${(error.stderr || error.message).slice(0, 600)}`);
      }
    } else {
      const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(190_000) });
      data = await response.json();
      if (!response.ok) throw new Error(data.error ?? `Region HTTP ${response.status}`);
    }
    if (data.error) throw new Error(data.error);
    return data;
  };
}

export class RegionClient {
  constructor(request = regionTransport()) { this.request = request; this.cache = new Map(); }
  list() { return this.request('/regions'); }
  async context(region, refresh = false, progress = () => {}) {
    let job = await this.request('/capture', { region, refresh }, 'POST');
    const deadline = Date.now() + 180_000;
    while (job.status === 'capturing') {
      progress(job);
      if (Date.now() > deadline) throw new Error(`Capture is still running (${job.snapshot}); retry without refresh to continue`);
      await delay(500);
      job = await this.request('/snapshot', { region, snapshot: job.snapshot, metadata: true });
    }
    if (job.status !== 'ready') throw new Error(job.error ?? 'Region capture failed');
    return this.snapshot(region, job.snapshot);
  }
  async snapshot(region, snapshot) {
    // Revalidate every read, including cache hits, so revoke, resize and server switches take effect.
    const info = await this.request('/snapshot', { region, snapshot, metadata: true });
    if (info.status !== 'ready') throw new Error(info.error ?? 'Snapshot is not ready');
    if (this.cache.has(snapshot)) return this.cache.get(snapshot);
    const data = await this.request('/snapshot', { region, snapshot });
    if (data.snapshot !== snapshot || !data.columns) throw new Error('Snapshot data is unavailable');
    while (this.cache.size >= 2) this.cache.delete(this.cache.keys().next().value);
    this.cache.set(snapshot, data);
    return data;
  }
}

export function selectBounds(data, selection = {}) {
  const b = { ...data.bounds, ...selection };
  for (const axis of ['X', 'Y', 'Z']) {
    const lo = b[`min${axis}`], hi = b[`max${axis}`];
    if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo > hi) throw new Error(`Invalid ${axis} bounds`);
    if (lo < data.bounds[`min${axis}`] || hi > data.bounds[`max${axis}`]) throw new Error('Requested area is outside the shared region');
  }
  return b;
}

export function columnAt(data, x, z) {
  const b = data.bounds;
  if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) throw new Error('Column is outside the shared region');
  return data.columns[(z - b.minZ) * (b.maxX - b.minX + 1) + x - b.minX];
}

export function blockAt(data, x, y, z) {
  if (y < data.bounds.minY || y > data.bounds.maxY) throw new Error('Height is outside the snapshot');
  const runs = columnAt(data, x, z);
  if (!runs) return null;
  for (let i = 0; i < runs.length; i += 3) if (runs[i] <= y && y <= runs[i + 1]) return { ...data.palette[runs[i + 2]], y };
  throw new Error('Incomplete column in snapshot');
}

export function surfaceAt(data, x, z, { minY = data.bounds.minY, maxY = data.bounds.maxY, surface = 'top' } = {}) {
  const runs = columnAt(data, x, z);
  if (!runs) return null;
  for (let i = runs.length - 3; i >= 0; i -= 3) {
    if (runs[i] > maxY || runs[i + 1] < minY) continue;
    const state = data.palette[runs[i + 2]];
    if (state.air) continue;
    if (surface === 'solid' && (!state.solid || /_leaves$|_log$|_wood$|_stem$|_hyphae$/.test(state.name))) continue;
    return { ...state, y: Math.min(maxY, runs[i + 1]) };
  }
  return { name: 'minecraft:air', air: true, y: null, color: 0 };
}

export function summarize(data, selection) {
  const bounds = selectBounds(data, selection);
  let unknown = 0, empty = 0, low = Infinity, high = -Infinity;
  const blocks = new Map();
  const water = [];
  const facilities = [];
  for (let z = bounds.minZ; z <= bounds.maxZ; z++) for (let x = bounds.minX; x <= bounds.maxX; x++) {
    const top = surfaceAt(data, x, z, bounds);
    if (!top) { unknown++; continue; }
    if (top.air) { empty++; continue; }
    low = Math.min(low, top.y); high = Math.max(high, top.y);
    blocks.set(top.name, (blocks.get(top.name) ?? 0) + 1);
    if (top.fluid && water.length < 16) water.push({ x, y: top.y, z });
    const runs = columnAt(data, x, z);
    for (let i = 0; i < runs.length; i += 3) {
      if (runs[i] > bounds.maxY || runs[i + 1] < bounds.minY) continue;
      const state = data.palette[runs[i + 2]];
      if (/:(chest|trapped_chest|barrel|furnace|blast_furnace|smoker|crafting_table|enchanting_table|farmland)$|_bed$|_door$|_sign$/.test(state.name) && facilities.length < 64) {
        facilities.push({ x, z, minY: Math.max(runs[i], bounds.minY), maxY: Math.min(runs[i + 1], bounds.maxY), block: state.name });
      }
    }
  }
  return {
    region: data.region.id, snapshot: data.snapshot, worldId: data.worldId, dimension: data.region.dimension,
    bounds, coreBounds: data.region.bounds, buffer: data.region.buffer,
    capturedFrom: data.capturedFrom, capturedTo: data.capturedTo, sources: data.sources,
    unknownColumns: unknown, emptyColumns: empty,
    surfaceHeight: Number.isFinite(low) ? { min: low, max: high } : null,
    topSurfaceBlocks: [...blocks].sort((a, b) => b[1] - a[1]).slice(0, 16).map(([block, columns]) => ({ block, columns })),
    fluidExamples: water, facilityExamples: facilities,
    notes: [
      'Coordinates and bounds are inclusive. North is -Z; east is +X. Heights are block Y, not standing height.',
      'Surface height includes roofs and trees. It is not a buildable-ground or clearance assessment.',
      'Missing columns are unknown, not air. No new chunks are generated.',
      'Live chunks are copied during the capture interval; unloaded chunks use their last saved data. This is not an atomic whole-region instant.',
      'Facility positions are capped examples, not a complete building inventory. Container contents and entities are excluded.',
    ],
  };
}

export function inspectBlocks(data, selection) {
  const b = selectBounds(data, selection);
  const volume = (b.maxX - b.minX + 1) * (b.maxZ - b.minZ + 1) * (b.maxY - b.minY + 1);
  if (volume > 32768) throw new Error('Exact block queries are limited to 32768 blocks; specify a smaller XYZ box');
  const palette = [], ids = new Map(), columns = [];
  for (let z = b.minZ; z <= b.maxZ; z++) for (let x = b.minX; x <= b.maxX; x++) {
    const source = columnAt(data, x, z);
    if (!source) { columns.push({ x, z, runs: null }); continue; }
    const runs = [];
    for (let i = 0; i < source.length; i += 3) {
      const minY = Math.max(source[i], b.minY), maxY = Math.min(source[i + 1], b.maxY);
      if (minY > maxY) continue;
      const original = source[i + 2];
      if (!ids.has(original)) { ids.set(original, palette.length); palette.push(data.palette[original]); }
      runs.push([minY, maxY, ids.get(original)]);
    }
    columns.push({ x, z, runs });
  }
  return { snapshot: data.snapshot, region: data.region.id, dimension: data.region.dimension, bounds: b,
    encoding: 'Each run is [minY, maxY, paletteIndex], inclusive. null means unknown; air is explicit.', palette, columns };
}
