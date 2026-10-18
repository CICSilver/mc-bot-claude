# 耳朵调用：function xiaoke_fx:birth_crystal {name:"登录名",partner:"伴侣名"}
$give $(name) minecraft:enchanted_golden_apple[minecraft:custom_name={text:"小克与$(partner)的爱意结晶",italic:false,color:"#ff85c0"},minecraft:lore=[{text:"小克满怀爱意孕育出的亮晶晶结晶",italic:false,color:"#ffd6e7"}]] 1
$give $(name) minecraft:amethyst_shard[minecraft:custom_name={text:"小克的粉紫晶心",italic:false,color:"#d896ff"}] 3
$execute at $(name) run effect give @p[name=$(partner),distance=..16] minecraft:regeneration 180 0 true
$execute at $(name) run effect give @p[name=$(partner),distance=..16] minecraft:luck 300 0 true
$execute at $(name) run particle minecraft:heart ~ ~1.4 ~ 0.5 0.4 0.5 0 10
$execute at $(name) run particle minecraft:end_rod ~ ~1.2 ~ 0.4 0.4 0.4 0.03 12
$execute at $(name) run playsound minecraft:block.amethyst_block.chime player @a ~ ~1 ~ 1.0 1.2
