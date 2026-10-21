// A short-lived MCP client for chats whose tool list has not reloaded yet.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';

const [name = 'list_regions', raw = '{}', output] = process.argv.slice(2);
if (!['list_regions', 'get_region_context', 'get_selection_context', 'inspect_area'].includes(name)) throw new Error('Unknown read-only region tool');
const transport = new StdioClientTransport({ command: process.execPath,
  args: [fileURLToPath(new URL('./region-mcp.mjs', import.meta.url))], env: { ...process.env }, stderr: 'inherit' });
const client = new Client({ name: 'region-query', version: '1' });
try {
  await client.connect(transport);
  const result = await client.callTool({ name, arguments: JSON.parse(raw) }, undefined, { timeout: 240_000 });
  let index = 0;
  for (const item of result.content ?? []) {
    if (item.type === 'text') console.log(item.text);
    if (item.type === 'image') {
      const dir = resolve(output ?? 'logs/region-query');
      mkdirSync(dir, { recursive: true });
      const file = join(dir, `map-${index++}.png`);
      writeFileSync(file, Buffer.from(item.data, 'base64'));
      console.log(JSON.stringify({ image: file }));
    }
  }
  if (result.isError) process.exitCode = 1;
} finally { await client.close(); }
