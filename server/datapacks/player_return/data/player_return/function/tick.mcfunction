execute as @a[scores={respawn=1..}] at @s run function player_return:return
execute as @a[scores={back=1..}] at @s run function player_return:back
scoreboard players enable @a respawn
scoreboard players enable @a back
