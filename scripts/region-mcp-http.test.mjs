import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createRegionHttpServer } from './region-mcp-http.mjs';

const token = 'test-only-region-token-with-at-least-32-characters';
const data = {
  snapshot: 'test-snapshot', worldId: 'test', capturedFrom: '2026-01-01', capturedTo: '2026-01-01',
  region: { id: 'home', kind: 'region', dimension: 'minecraft:overworld', buffer: 0, bounds: { minX: 0, maxX: 0, minZ: 0, maxZ: 0 } },
  bounds: { minX: 0, maxX: 0, minY: 64, maxY: 65, minZ: 0, maxZ: 0 }, sources: { live: 1 },
  palette: [{ name: 'minecraft:stone', properties: {}, color: 0x777777, air: false, solid: true, fluid: false }], columns: [[64, 65, 0]],
};
async function fixture(t) {
  let calls = 0;
  const backend = { list: async () => { calls++; return { regions: [data.region] }; }, context: async () => data, snapshot: async () => data };
  const server = createRegionHttpServer({ token, client: backend });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return { url: new URL(`http://127.0.0.1:${server.address().port}/minecraft-mcp`), calls: () => calls };
}

test('HTTP gateway denies missing, wrong and URL-only tokens before calling the backend', async t => {
  const f = await fixture(t);
  for (const authorization of [undefined, 'Bearer wrong-token', `Basic ${token}`]) {
    const result = await fetch(f.url, { method: 'POST', headers: authorization ? { authorization } : {}, body: '{}' });
    assert.equal(result.status, 401); assert.match(result.headers.get('www-authenticate'), /^Bearer/);
    assert.ok(!(await result.text()).includes(token));
  }
  const withQuery = new URL(f.url); withQuery.searchParams.set('token', token);
  assert.equal((await fetch(withQuery)).status, 401); assert.equal(f.calls(), 0);
});

test('HTTP gateway rejects foreign browser origins and unsupported methods', async t => {
  const f = await fixture(t), headers = { authorization: `Bearer ${token}` };
  assert.equal((await fetch(f.url, { method: 'POST', headers: { ...headers, origin: 'https://example.org' }, body: '{}' })).status, 403);
  for (const method of ['GET', 'DELETE', 'PUT']) assert.equal((await fetch(f.url, { method, headers })).status, 405);
  assert.equal(f.calls(), 0);
});

test('standard MCP HTTP client sees only four read-only tools and bounded data', async t => {
  const f = await fixture(t);
  const client = new Client({ name: 'http-test', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(f.url, { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  t.after(() => client.close());
  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map(t => t.name).sort(), ['get_region_context', 'get_selection_context', 'inspect_area', 'list_regions']);
  assert.ok(tools.tools.every(t => t.annotations.readOnlyHint && t.annotations.destructiveHint === false));
  const list = await client.callTool({ name: 'list_regions', arguments: {} });
  assert.equal(JSON.parse(list.content[0].text).regions[0].id, 'home');
  const context = await client.callTool({ name: 'get_region_context', arguments: { region: 'home' } });
  assert.equal(context.content.filter(c => c.type === 'image').length, 2);
  assert.equal(JSON.parse(context.content[0].text).snapshot, data.snapshot);
  const outside = await client.callTool({ name: 'inspect_area', arguments: { region: 'home', snapshot: data.snapshot,
    area: { minX: -1, maxX: 0, minZ: 0, maxZ: 0 }, mode: 'blocks' } });
  assert.equal(outside.isError, true); assert.match(outside.content[0].text, /outside/);
  const unshared = await client.callTool({ name: 'get_region_context', arguments: { region: 'unshared' } });
  assert.equal(unshared.isError, true);
  const unknown = await client.callTool({ name: 'set_block', arguments: {} });
  assert.equal(unknown.isError, true);
});

test('HTTP gateway refuses empty startup credentials', () => {
  assert.throws(() => createRegionHttpServer({ token: '' }), /token/);
});
