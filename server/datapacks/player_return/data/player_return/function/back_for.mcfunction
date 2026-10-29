$execute unless data storage player_return:history players.p$(id) run return run tellraw @s {"text":"先使用 /trigger respawn，之后可用 /trigger back 返回原位","color":"yellow"}
$function player_return:back_tp with storage player_return:history players.p$(id)
tellraw @s {"text":"已返回传送前的位置","color":"green"}
