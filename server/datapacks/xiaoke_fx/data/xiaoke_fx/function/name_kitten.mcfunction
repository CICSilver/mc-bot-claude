# 耳朵调用：function xiaoke_fx:name_kitten {name:"登录名",tag:"宝宝标签",label:"新名字"}
$execute at $(name) run data modify entity @e[type=minecraft:cat,tag=$(tag),limit=1,sort=nearest] CustomName set value {text:"$(label)",color:"#ffb6c1"}
$execute at $(name) run data modify entity @e[type=minecraft:cat,tag=$(tag),limit=1,sort=nearest] CustomNameVisible set value 1b
$give $(name) minecraft:name_tag[minecraft:custom_name={text:"$(label)",italic:false,color:"#ffb6c1"}] 1
$execute at $(name) run particle minecraft:heart ~ ~1.2 ~ 0.4 0.3 0.4 0 8
$execute at $(name) run playsound minecraft:entity.cat.ambient player @a ~ ~1 ~ 0.9 1.5
