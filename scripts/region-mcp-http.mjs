import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createRegionMcp } from './region-mcp.mjs';
import { RegionClient } from './region-data.mjs';

const digest = value => createHash('sha256').update(value).digest();
const reply = (res, status, message, headers = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify({ error: message }));
};

export function createRegionHttpServer({ token, client = new RegionClient(),
  allowedOrigins = ['https://lemalin.icu', 'https://www.lemalin.icu'] } = {}) {
  if (typeof token !== 'string' || token.length < 32) throw new Error('A region MCP token of at least 32 characters is required');
  const expected = digest(token);
  const origins = new Set(allowedOrigins);
  return createServer(async (req, res) => {
    const path = (req.url ?? '').split('?')[0];
    if (!['/minecraft-mcp', '/minecraft-mcp/'].includes(path)) return reply(res, 404, 'Not found');
    const credential = /^Bearer ([^\s]+)$/i.exec(req.headers.authorization ?? '')?.[1] ?? '';
    if (!timingSafeEqual(digest(credential), expected)) {
      return reply(res, 401, 'Bearer token required', { 'WWW-Authenticate': 'Bearer realm="minecraft-regions"' });
    }
    if (req.headers.origin && !origins.has(req.headers.origin)) return reply(res, 403, 'Origin is not allowed');
    if (req.method !== 'POST') return reply(res, 405, 'Use MCP POST requests', { Allow: 'POST' });

    // A fresh stateless transport per request; the backend cache still revalidates region access.
    const server = createRegionMcp(client);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.setHeader('Cache-Control', 'no-store');
    res.once('close', () => { void server.close().catch(() => {}); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch {
      console.error('Region MCP request failed');
      if (!res.headersSent) reply(res, 500, 'MCP request failed');
      else res.end();
      await server.close().catch(() => {});
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.env.REGION_MCP_TOKEN_FILE;
  if (!file) throw new Error('REGION_MCP_TOKEN_FILE is required');
  const server = createRegionHttpServer({ token: readFileSync(file, 'utf8').trim() });
  server.listen(25621, '127.0.0.1', () => console.log('Minecraft region MCP listening on 127.0.0.1:25621'));
  const stop = () => { server.close(); server.closeIdleConnections(); };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}
