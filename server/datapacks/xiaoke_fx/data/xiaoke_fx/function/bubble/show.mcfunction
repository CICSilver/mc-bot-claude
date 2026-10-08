# 耳朵调用：function xiaoke_fx:bubble/show {name:"登录名",id:"编号",ttl:"tick",text:"字",color:"#rrggbb",bg:"ARGB 整数",scale:"大小"}
# 字已经在耳朵那边过滤过（没有引号、反斜杠、换行）。同一个人的旧气泡先收掉
$kill @e[type=minecraft:text_display,tag=xkfx_bubble,scores={xkfx_id=$(id)}]
$scoreboard players set $(name) xkfx_id $(id)
$execute at $(name) run summon minecraft:text_display ~ ~2.45 ~ {Tags:["xkfx_bubble","xkfx_new"],billboard:"center",view_range:0.3f,teleport_duration:2,line_width:160,shadow:1b,background:$(bg),text:{text:"$(text)",color:"$(color)"},transformation:{left_rotation:[0f,0f,0f,1f],right_rotation:[0f,0f,0f,1f],translation:[0f,0f,0f],scale:[$(scale)f,$(scale)f,$(scale)f]}}
$scoreboard players set @e[type=minecraft:text_display,tag=xkfx_new] xkfx_id $(id)
$scoreboard players set @e[type=minecraft:text_display,tag=xkfx_new] xkfx_ttl $(ttl)
tag @e[type=minecraft:text_display,tag=xkfx_new] remove xkfx_new
