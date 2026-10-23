# Copper Utilities

Server-side data pack for Minecraft Java 26.1 (data pack format 101.1).
All recipes use the copper_utilities namespace and produce vanilla items.
Existing iron and gold recipes are preserved.

| Output | Ingredients |
| --- | --- |
| 16 rails | 6 copper ingots + 1 stick |
| 6 powered rails | 6 copper ingots + 1 stick + 1 redstone dust |
| 1 hopper | 5 copper ingots + 1 chest |
| 1 minecart | 5 copper ingots |
| 1 anvil | 1 chipped anvil + 1 copper block |
| 1 chipped anvil | 1 damaged anvil + 1 copper block |

The four infrastructure recipes use the vanilla crafting layouts, with
copper ingots replacing iron or gold. Anvil repairs are shapeless and consume
one copper block per damage stage. This pack adds no copper anvil crafting recipe.

Holding a copper ingot or copper block when inventory changes unlocks all six
recipes. There are no tick functions or custom items.

## Installation

Copy copper_utilities into world/datapacks, then run:

```text
reload
```

Check datapack list enabled. If the pack is listed as available instead, run
datapack enable "file/copper_utilities". Existing online players can immediately
receive the recipe-book entries with:

```text
advancement grant @a only copper_utilities:recipes/copper_utilities
```
