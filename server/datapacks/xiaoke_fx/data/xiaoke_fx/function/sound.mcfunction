# 耳朵调用：function xiaoke_fx:sound {name:"登录名",sound:"声音事件",volume:"音量",pitch:"音高"}，在她身上放一个声音，附近的人都听得到
$execute at $(name) run playsound minecraft:$(sound) player @a ~ ~1 ~ $(volume) $(pitch)
