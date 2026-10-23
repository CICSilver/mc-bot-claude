# Golem Recall

Use `/trigger golem` while standing on open ground outside the pen.
The nearest player-built iron golem within 32 blocks in the same dimension is
teleported to a clear spot two blocks away along either horizontal axis. No operator permission is needed.

The pack checks eight surrounding positions at the player's foot level. Each
landing spot needs a supported center block and a clear 3 x 3 x 3 space. If all
spots are occupied, the golem stays in place and the player receives a message.

Selection uses vanilla `PlayerCreated:1b`. Minecraft stores whether a golem was
player-built, not the builder's identity. Natural village golems are excluded.
Health, equipment, name and AI are preserved. Recall does not assign a patrol area.

Copy this directory to `world/datapacks/golem_recall`, then reload the data packs.
This uses the same trigger command pattern as the server's `respawn` and `back`.
