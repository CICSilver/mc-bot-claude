import test from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { RegionClient, blockAt, inspectBlocks, selectBounds, summarize } from './region-data.mjs';
import { renderRegionMap } from './region-map.mjs';
import { createRegionMcp } from './region-mcp.mjs';

const fixture = () => ({
  snapshot: 'snapshot-1', worldId: 'test-world', capturedFrom: '2026-01-01T00:00:00Z', capturedTo: '2026-01-01T00:00:01Z',
  region: { id: 'home', kind: 'region', dimension: 'minecraft:overworld', buffer: 0, bounds: { minX: -1, maxX: 0, minZ: -1, maxZ: 0 } },
  bounds: { minX: -1, maxX: 0, minZ: -1, maxZ: 0, minY: -64, maxY: 319 }, sources: { live: 1, disk: 0, missing: 1 },
  palette: [
    { name: 'minecraft:air', properties: {}, color: 0, air: true, solid: false, fluid: false },
    { name: 'minecraft:stone', properties: {}, color: 0x777777, air: false, solid: true, fluid: false },
    { name: 'minecraft:water', properties: { level: '0' }, color: 0x4050c0, air: false, solid: false, fluid: true },
    { name: 'minecraft:oak_stairs', properties: { facing: 'north', half: 'bottom' }, color: 0xb88b55, air: false, solid: true, fluid: false },
  ],
  columns: [[-64, 63, 1, 64, 64, 3, 65, 319, 0], [-64, 62, 1, 63, 64, 2, 65, 319, 0], null, [-64, 319, 0]],
});

test('region data retains coordinates, unknown columns, explicit air and block states', () => {
  const data = fixture();
  const summary = summarize(data);
  assert.equal(summary.unknownColumns, 1);
  assert.equal(summary.emptyColumns, 1);
  assert.deepEqual(summary.surfaceHeight, { min: 64, max: 64 });
  assert.equal(blockAt(data, -1, 64, -1).properties.facing, 'north');
  assert.equal(blockAt(data, -1, 64, 0), null);
  assert.equal(blockAt(data, 0, 64, 0).air, true);
  const blocks = inspectBlocks(data, { minX: -1, maxX: -1, minZ: -1, maxZ: -1, minY: 63, maxY: 65 });
  assert.deepEqual(blocks.columns[0].runs.map(r => r.slice(0, 2)), [[63, 63], [64, 64], [65, 65]]);
  assert.equal(blocks.palette[1].properties.half, 'bottom');
  assert.throws(() => selectBounds(data, { minX: -2 }), /outside/);
  assert.throws(() => inspectBlocks({ ...data, bounds: { ...data.bounds, maxX: 200 } }, {}), /32768/);
});

test('coordinate maps are real nonblank PNGs for surface, height and floor slice', () => {
  for (const view of ['surface', 'height', 'slice']) {
    const png = PNG.sync.read(renderRegionMap(fixture(), undefined, { view, y: 64 }));
    assert.ok(png.width >= 340 && png.height > 100);
    const colors = new Set();
    for (let i = 0; i < png.data.length; i += 4) colors.add(png.data.subarray(i, i + 3).toString('hex'));
    assert.ok(colors.size >= 4);
  }
});

test('cached snapshots recheck server authorization after revoke', async () => {
  let revoked = false, downloads = 0;
  const client = new RegionClient(async (path, params) => {
    if (revoked) throw new Error('region revoked');
    if (params.metadata) return { status: 'ready' };
    downloads++;
    return fixture();
  });
  await client.snapshot('home', 'snapshot-1');
  await client.snapshot('home', 'snapshot-1');
  assert.equal(downloads, 1);
  revoked = true;
  await assert.rejects(client.snapshot('home', 'snapshot-1'), /revoked/);
});

test('MCP exposes four read-only tools and returns image content plus compact text', async () => {
  const data = fixture();
  const backend = { list: async () => ({ regions: [data.region] }), context: async () => data, snapshot: async () => data };
  const server = createRegionMcp(backend);
  const client = new Client({ name: 'region-test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  try {
    const listed = await client.listTools();
    assert.equal(listed.tools.length, 4);
    assert.ok(listed.tools.every(t => t.annotations.readOnlyHint));
    const context = await client.callTool({ name: 'get_region_context', arguments: { region: 'home' } });
    assert.equal(context.content.filter(c => c.type === 'image').length, 2);
    assert.equal(JSON.parse(context.content[0].text).unknownColumns, 1);
    assert.ok(!context.content[0].text.includes('"columns":['));
    const rejected = await client.callTool({ name: 'inspect_area', arguments: { region: 'home', snapshot: 'snapshot-1',
      area: { minX: -10, maxX: 0, minZ: -1, maxZ: 0 } } });
    assert.equal(rejected.isError, true);
  } finally { await client.close(); await server.close(); }
});
