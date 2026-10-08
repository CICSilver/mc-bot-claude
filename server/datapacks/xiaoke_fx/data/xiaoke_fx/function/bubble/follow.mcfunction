# 以气泡的身份执行
scoreboard players remove @s xkfx_ttl 1
execute if score @s xkfx_ttl matches ..0 run return run kill @s
scoreboard players operation #id xkfx_tmp = @s xkfx_id
execute as @a if score @s xkfx_id = #id xkfx_tmp run tag @s add xkfx_owner
execute unless entity @a[tag=xkfx_owner] run return run kill @s
execute at @a[tag=xkfx_owner,limit=1] run tp @s ~ ~2.45 ~
tag @a[tag=xkfx_owner] remove xkfx_owner
