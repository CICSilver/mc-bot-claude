scoreboard players set @s respawn 0
function player_return:save_origin
execute if data entity @s respawn run function player_return:prepare
execute unless data entity @s respawn run function player_return:world_spawn
tellraw @s {"text":"已回到复活点","color":"green"}
