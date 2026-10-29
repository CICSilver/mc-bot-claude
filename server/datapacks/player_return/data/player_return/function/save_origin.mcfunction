execute unless score @s pr_id matches 1.. run scoreboard players add #next pr_id 1
execute unless score @s pr_id matches 1.. run scoreboard players operation @s pr_id = #next pr_id
execute store result storage player_return:runtime player.id int 1 run scoreboard players get @s pr_id
function player_return:save_origin_for with storage player_return:runtime player
