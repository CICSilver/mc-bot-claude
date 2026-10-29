execute positioned ~ ~1 ~ if block ~ ~ ~ minecraft:air if block ~ ~1 ~ minecraft:air run return run function player_return:arrive
execute positioned ~1 ~ ~ if block ~ ~ ~ minecraft:air if block ~ ~1 ~ minecraft:air unless block ~ ~-1 ~ minecraft:air unless block ~ ~-1 ~ minecraft:water unless block ~ ~-1 ~ minecraft:lava run return run function player_return:arrive
execute positioned ~-1 ~ ~ if block ~ ~ ~ minecraft:air if block ~ ~1 ~ minecraft:air unless block ~ ~-1 ~ minecraft:air unless block ~ ~-1 ~ minecraft:water unless block ~ ~-1 ~ minecraft:lava run return run function player_return:arrive
execute positioned ~ ~ ~1 if block ~ ~ ~ minecraft:air if block ~ ~1 ~ minecraft:air unless block ~ ~-1 ~ minecraft:air unless block ~ ~-1 ~ minecraft:water unless block ~ ~-1 ~ minecraft:lava run return run function player_return:arrive
execute positioned ~ ~ ~-1 if block ~ ~ ~ minecraft:air if block ~ ~1 ~ minecraft:air unless block ~ ~-1 ~ minecraft:air unless block ~ ~-1 ~ minecraft:water unless block ~ ~-1 ~ minecraft:lava run return run function player_return:arrive
function player_return:world_spawn
