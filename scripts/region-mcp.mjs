import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { RegionClient, summarize, inspectBlocks, selectBounds } from './region-data.mjs';
import { renderRegionMap } from './region-map.mjs';

const box = z.object({ minX: z.number().int(), maxX: z.number().int(), minZ: z.number().int(), maxZ: z.number().int(),
  minY: z.number().int().optional(), maxY: z.number().int().optional() });
const annotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const text = data => ({ type: 'text', text: JSON.stringify(data) });
const image = png => ({ type: 'image', mimeType: 'image/png', data: png.toString('base64') });
const selection = area => Object.fromEntries(Object.entries(area ?? {}).filter(([, value]) => value !== undefined));

export function createRegionMcp(client = new RegionClient()) {
  const server = new McpServer({ name: 'minecraft-regions', version: '1.0.0' }, {
    instructions: 'Read-only Minecraft planning data. Start with list_regions, then get_region_context or get_selection_context. '
      + 'All IDs refer to regions explicitly shared in game. Pin inspect_area to the returned snapshot. '
      + 'Never interpret unknown columns as empty land or roofs as ground. Query exact small XYZ boxes before planning changes. '
      + 'No tool here places blocks, moves players, expands access, or registers regions. Region IDs and coordinate axes are case-sensitive.',
  });
  const register = (name, description, inputSchema, handler) => server.registerTool(name, { description, inputSchema, annotations }, async args => {
    try { return await handler(args); }
    catch (error) { return { isError: true, content: [text({ error: error.message })] }; }
  });
  register('list_regions', 'List registered living areas and manually shared selections. No world blocks are returned.', {}, async () => ({ content: [text(await client.list())] }));
  const context = async (id, kind, refresh) => {
    const listing = await client.list();
    const region = listing.regions.find(r => r.id === id);
    if (!region) throw new Error(`Region ${id} is not shared. In game: /region select, right-click two corners, then /region save ${id} or /region share ${id}`);
    if (region.kind !== kind) throw new Error(`Use ${region.kind === 'region' ? 'get_region_context' : 'get_selection_context'} for ${id}`);
    const data = await client.context(id, refresh);
    return { content: [text(summarize(data)), image(renderRegionMap(data)), image(renderRegionMap(data, undefined, { view: 'height' })),
      text({ mapLegend: 'First: top-surface block colors. Second: surface height (low blue to high yellow). Pink outline: registered core; outside it is the authorized buffer. Gray checkerboard: missing data. North is up. Images are schematic maps, not texture renders.' })] };
  };
  register('get_region_context', 'Read a registered living area and its authorized buffer. Returns compact summary and coordinate maps. refresh=true captures current live/saved data.',
    { region: z.string(), refresh: z.boolean().default(false) }, ({ region, refresh }) => context(region, 'region', refresh));
  register('get_selection_context', 'Read an area shared with /region share. Returns compact summary and coordinate maps.',
    { selection: z.string(), refresh: z.boolean().default(false) }, ({ selection: id, refresh }) => context(id, 'selection', refresh));
  register('inspect_area', 'Inspect a smaller area inside an existing snapshot. summary gives statistics; surface/height/slice give maps; blocks gives exact run-length encoded block states (max 32768 blocks). No inventory contents.',
    { region: z.string(), snapshot: z.string(), area: box, mode: z.enum(['summary', 'surface', 'height', 'slice', 'blocks']).default('summary'),
      surface: z.enum(['top', 'solid']).default('top'), y: z.number().int().optional() },
    async ({ region, snapshot, area, mode, surface, y }) => {
      const data = await client.snapshot(region, snapshot);
      const bounds = selectBounds(data, selection(area));
      if (mode === 'blocks') {
        const result = text(inspectBlocks(data, bounds));
        if (result.text.length > 48_000) throw new Error('Exact data exceeds the response budget; request a smaller XYZ box');
        return { content: [result] };
      }
      if (mode === 'summary') return { content: [text(summarize(data, bounds))] };
      return { content: [text({ region, snapshot, dimension: data.region.dimension, bounds, mode, surface, y,
        note: 'solid skips vegetation trunks/leaves and non-colliding blocks; buildings remain. It is not a ground classifier.' }),
        image(renderRegionMap(data, bounds, { view: mode, surface, y }))] };
    });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await createRegionMcp().connect(new StdioServerTransport());
}
