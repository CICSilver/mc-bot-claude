# Remote region MCP

The existing four read-only tools are served over stateless Streamable HTTP at
`https://lemalin.icu/minecraft-mcp`. The stdio entry point remains unchanged.

## Runtime

- Application: `/opt/minecraft-regions`, with `region-mcp-http.mjs`, `region-mcp.mjs`,
  `region-data.mjs`, and `region-map.mjs` under `scripts/`.
- Dependencies: repository `package.json` and `package-lock.json`; install with
  `npm ci --omit=dev --ignore-scripts`.
- Node runtime: `/opt/minecraft-regions/runtime/node`, copied from the server's
  installed Node 24 runtime so the service needs no access to `/root`.
- Listener: `127.0.0.1:25621`; backend remains `127.0.0.1:25620`.
- Unit: `minecraft-regions-mcp.service`, running with a systemd dynamic user.
- Secret: `/etc/minecraft-regions/token`, root-owned mode `0600`. systemd supplies
  a private copy using `LoadCredential`; the token is never placed in arguments.

Caddy forwards only `/minecraft-mcp` and `/minecraft-mcp/` to the loopback MCP
listener. Do not expose the underlying region API or add this route to the public
static preview. Requests require `Authorization: Bearer <token>` on every call.
URL/query tokens are not accepted. Invalid credentials return 401. Foreign Origin
headers return 403. Authenticated GET and DELETE return 405 because this stateless
server uses POST/JSON responses and has no standalone SSE stream or sessions.

Region registration, revocation, snapshot bounds and exact-block limits remain
enforced by the existing backend and shared MCP implementation. The service has
no block-placement, console, shell, inventory or region-registration tools.

## Grok Bot

Add a custom MCP plugin using Remote HTTPS. Use the URL above and the bearer token
in its authentication field or an `Authorization` header. Enter secrets through
the client's secret/configuration UI, not into an ordinary chat message.

After connecting, call `list_regions`, then `get_region_context` for `home`.
Use the returned snapshot with `inspect_area`. Refresh takes up to 180 seconds;
set a 240-second tool timeout when the client exposes that setting.

## Rotation and validation

Replace the root-only token file with a new 32-byte random value and restart only
`minecraft-regions-mcp`. Reconfigure clients with the new value. Old tokens stop
working on subsequent requests. Do not restart Minecraft.

Run `node --test scripts/region-mcp-http.test.mjs scripts/region-planner.test.mjs`
locally. For deployment validation, run `scripts/probe-region-mcp-http.mjs` with
the public URL and a private token file. The probe prints checks, not credentials.
