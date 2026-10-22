$data modify storage player_return:history players.p$(id) set value {}
$data modify storage player_return:history players.p$(id).dimension set from entity @s Dimension
$data modify storage player_return:history players.p$(id).x set from entity @s Pos[0]
$data modify storage player_return:history players.p$(id).y set from entity @s Pos[1]
$data modify storage player_return:history players.p$(id).z set from entity @s Pos[2]
$data modify storage player_return:history players.p$(id).yaw set from entity @s Rotation[0]
$data modify storage player_return:history players.p$(id).pitch set from entity @s Rotation[1]
