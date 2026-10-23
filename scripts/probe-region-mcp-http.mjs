import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const [endpoint, tokenFile] = process.argv.slice(2);
if (!endpoint || !tokenFile) throw new Error('Usage: node scripts/probe-region-mcp-http.mjs <https-url> <private-token-file>');
const url = new URL(endpoint), token = readFileSync(tokenFile, 'utf8').trim();
const headers = { Authorization: `Bearer ${token}` };
const checks = [];
assert.equal((await fetch(url)).status, 401); checks.push('missing token: 401');
assert.equal((await fetch(url, { headers: { Authorization: 'Bearer incorrect-probe-token' } })).status, 401); checks.push('wrong token: 401');
assert.equal((await fetch(url, { method: 'POST', headers: { ...headers, Origin: 'https://example.org' }, body: '{}' })).status, 403); checks.push('foreign origin: 403');
assert.equal((await fetch(url, { headers })).status, 405); checks.push('authenticated GET: 405 (POST/JSON transport)');
const client = new Client({ name: 'minecraft-regions-deployment-probe', version: '1' });
try {
  await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers } }));
  const tools = (await client.listTools()).tools;
  assert.deepEqual(tools.map(t => t.name).sort(), ['get_region_context', 'get_selection_context', 'inspect_area', 'list_regions']);
  assert.ok(tools.every(t => t.annotations.readOnlyHint && !t.annotations.destructiveHint)); checks.push('exactly four read-only tools');
  const call = (name, args) => client.callTool({ name, arguments: args }, undefined, { timeout: 240_000 });
  const list = await call('list_regions', {}); assert.ok(!list.isError);
  assert.ok(JSON.parse(list.content[0].text).regions.some(r => r.id === 'home')); checks.push('home listed');
  const context = await call('get_region_context', { region: 'home', refresh: true }); assert.ok(!context.isError);
  const summary = JSON.parse(context.content.find(c => c.type === 'text').text);
  assert.equal(context.content.filter(c => c.type === 'image').length, 2); checks.push('fresh snapshot and two maps');
  const b = summary.bounds;
  const area = { minX: b.minX, maxX: Math.min(b.minX + 1, b.maxX), minZ: b.minZ, maxZ: Math.min(b.minZ + 1, b.maxZ), minY: 64, maxY: 66 };
  const exact = await call('inspect_area', { region: 'home', snapshot: summary.snapshot, area, mode: 'blocks' });
  assert.ok(!exact.isError); assert.ok(JSON.parse(exact.content[0].text).columns.length); checks.push('snapshot-pinned exact block read');
  const outside = await call('inspect_area', { region: 'home', snapshot: summary.snapshot, area: { ...area, minX: b.minX - 1 }, mode: 'blocks' });
  assert.equal(outside.isError, true); assert.match(outside.content[0].text, /outside/); checks.push('out-of-bounds read rejected');
  const unshared = await call('get_region_context', { region: '__unshared_probe__' }); assert.equal(unshared.isError, true); checks.push('unshared region rejected');
  const selection = await call('get_selection_context', { selection: 'home' }); assert.equal(selection.isError, true); checks.push('region/selection kind checked');
  const unknown = await call('set_block', {}); assert.equal(unknown.isError, true); checks.push('write tool absent');
  console.log(JSON.stringify({ ok: true, endpoint: url.href, checks, snapshot: summary.snapshot, bounds: summary.bounds }, null, 2));
} finally { await client.close(); }
