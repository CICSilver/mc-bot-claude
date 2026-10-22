# Planner

The main `/mc-planner/` page uses the merged v2 frontend in `web/`. The pink toolbar,
2D/3D split view, Y ruler, materials/progress/info tabs, and per-block completion
all use the existing version-1 plan contract.

## Build

Start from a copy of the current server site, including its `plans/`, `assets/`,
`overview.html`, and `guide/` files. Then run:

```sh
node scripts/build-planner.mjs /path/to/site-copy
```

The command updates only UI files. It checks that the registry and every registered
plan remain byte-identical. Never replace `plans/index.json` with a historical
single-plan copy. Register future buildings through the existing registry and
`plans/plan.schema.json`; no frontend coordinates are hard-coded.

## Compatibility

- `/mc-planner/`: canonical planner.
- `/mc-planner/v2/`: redirects to the canonical planner, preserving query and hash.
- `/mc-planner/legacy.html`: original simple guide.
- `/mc-planner/overview.html`: existing overall preview and two-point measuring.
- Layer completion keeps `mc-planner:done:<id>:<revision>:<palette>`.
- Per-block completion keeps `mc-planner:placed:<id>:<revision>:<palette>`.
- v2 theme/view preferences retain their keys. View changes also update the old
  `mc-planner:view` key so the simple guide resumes at the same layer.
- Share links keep plan, chapter, Y, palette, view, clipping and selected location.

Use `node --test planner/*.test.mjs` to check material counts and layer runs. Set
`PLANNER_SITE_DIR` to the site copy to include all registered plan fixtures.
Browser checks cover progress compatibility, both registered plans, desktop/mobile layout,
2D picking, 3D picking after layer changes, and full-building framing.

## Publish

Back up the current server site outside `/var/www`. Upload `app/`, `legacy.html`,
and the new main index to a temporary filename first. Replace the main index only
after the new assets are present; replace the v2 index with its redirect last.
No Caddy, MCP, Minecraft service or world changes are needed. Export updated plan
data first, then run this UI builder last; historical visualization exporters must
not publish their simple-guide index over the merged frontend.
