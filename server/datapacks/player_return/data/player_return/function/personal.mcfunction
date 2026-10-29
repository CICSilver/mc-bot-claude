$execute in $(dimension) positioned $(x).0 $(y).0 $(z).0 if block ~ ~ ~ #minecraft:beds run return run function player_return:find_spot
$execute in $(dimension) positioned $(x).0 $(y).0 $(z).0 if block ~ ~ ~ minecraft:respawn_anchor run return run function player_return:find_spot
function player_return:world_spawn
