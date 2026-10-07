# 每 tick 把气泡挪到主人头顶（原版的 /ride 不让东西骑在玩家身上），到时间了就收掉
execute as @e[type=minecraft:text_display,tag=xkfx_bubble] run function xiaoke_fx:bubble/follow
