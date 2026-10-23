scoreboard players set @s golem 0
scoreboard players set @s gr_ok 0
tag @e[type=minecraft:iron_golem,tag=gr_selected] remove gr_selected
tag @e[type=minecraft:iron_golem,nbt={PlayerCreated:1b},distance=..32,sort=nearest,limit=1] add gr_selected
execute unless entity @e[type=minecraft:iron_golem,tag=gr_selected,limit=1] run return run tellraw @s {"text":"附近 32 格内没有玩家建造的铁傀儡。","color":"yellow"}
execute align xyz positioned ~0.5 ~ ~0.5 run function golem_recall:find_spot
tag @e[type=minecraft:iron_golem,tag=gr_selected] remove gr_selected
execute if score @s gr_ok matches 1 run tellraw @s {"text":"铁傀儡已召回到身边。","color":"green"}
execute if score @s gr_ok matches 0 run tellraw @s {"text":"身边没有足够的落脚空间，请站到圈外空地再召回。","color":"yellow"}
