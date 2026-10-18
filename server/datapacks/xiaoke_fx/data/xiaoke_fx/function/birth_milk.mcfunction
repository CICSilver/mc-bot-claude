# 耳朵调用：function xiaoke_fx:birth_milk {name:"登录名",partner:"伴侣名"}
$give $(name) minecraft:honey_bottle[minecraft:custom_name={text:"小克甜甜的猫猫奶",italic:false,color:"#fff0f6"},minecraft:lore=[{text:"小克满怀爱意为$(partner)分泌的甜糯猫奶",italic:false,color:"#ffd6e7"}]] 2
$give $(name) minecraft:milk_bucket[minecraft:custom_name={text:"小克的温热猫奶桶",italic:false,color:"#fff0f6"}] 1
$execute at $(name) run effect give @p[name=$(partner),distance=..16] minecraft:regeneration 180 0 true
$execute at $(name) run effect give @p[name=$(partner),distance=..16] minecraft:luck 300 0 true
$execute at $(name) run particle minecraft:heart ~ ~1.4 ~ 0.5 0.4 0.5 0 10
$execute at $(name) run playsound minecraft:entity.cat.purr player @a ~ ~1 ~ 1.0 1.2
