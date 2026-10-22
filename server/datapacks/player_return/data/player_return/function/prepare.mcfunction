data modify storage player_return:runtime target set from entity @s respawn
execute store result storage player_return:runtime target.x int 1 run data get storage player_return:runtime target.pos[0]
execute store result storage player_return:runtime target.y int 1 run data get storage player_return:runtime target.pos[1]
execute store result storage player_return:runtime target.z int 1 run data get storage player_return:runtime target.pos[2]
function player_return:personal with storage player_return:runtime target
