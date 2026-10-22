scoreboard players set @s back 0
execute unless score @s pr_id matches 1.. run return run tellraw @s {"text":"先使用 /trigger respawn，之后可用 /trigger back 返回原位","color":"yellow"}
execute store result storage player_return:runtime player.id int 1 run scoreboard players get @s pr_id
function player_return:back_for with storage player_return:runtime player
