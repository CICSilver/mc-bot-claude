# 耳朵调用：function xiaoke_fx:birth_kitten {name:"登录名",owner:"伴侣名",tag:"宝宝标签",label:"初始显示名"}
$execute at $(name) run summon minecraft:cat ~ ~ ~ {Age:-2147483648,ForcedAge:-2147483648,Invulnerable:1b,variant:"minecraft:white",CollarColor:14b,PersistenceRequired:1b,CustomNameVisible:1b,CustomName:{text:"$(label)",color:"#ffb6c1"},Tags:["xiaoke_baby","$(tag)"]}
$execute at $(name) if entity @p[name=$(owner)] run data modify entity @e[type=minecraft:cat,tag=$(tag),limit=1,sort=nearest] Owner set from entity @p[name=$(owner)] UUID
$execute at $(name) unless entity @p[name=$(owner)] run data modify entity @e[type=minecraft:cat,tag=$(tag),limit=1,sort=nearest] Owner set from entity @p[name=$(name)] UUID
$give $(name) minecraft:name_tag[minecraft:custom_name={text:"$(label)",italic:false,color:"#ffb6c1"}] 1
$execute at $(name) run effect give @p[name=$(owner),distance=..16] minecraft:regeneration 180 0 true
$execute at $(name) run effect give @p[name=$(owner),distance=..16] minecraft:luck 300 0 true
$execute at $(name) run particle minecraft:heart ~ ~1.2 ~ 0.5 0.4 0.5 0 12
$execute at $(name) run playsound minecraft:entity.cat.purreow player @a ~ ~1 ~ 1.0 1.4
