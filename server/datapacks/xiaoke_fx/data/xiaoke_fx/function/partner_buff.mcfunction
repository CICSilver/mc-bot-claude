# 耳朵调用：function xiaoke_fx:partner_buff {name:"登录名",partner:"伴侣名"}
$execute at $(name) run effect give @p[name=$(partner),distance=..16] minecraft:regeneration 120 0 true
$execute at $(name) run effect give @p[name=$(partner),distance=..16] minecraft:luck 300 0 true
$execute at $(name) run particle minecraft:heart ~ ~1.5 ~ 0.6 0.4 0.6 0 8
$execute at $(name) run playsound minecraft:entity.cat.purr player @a ~ ~1 ~ 1.0 1.15
