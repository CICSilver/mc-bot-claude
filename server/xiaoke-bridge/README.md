# xiaoke-bridge

只装在服务端的 Fabric 小模组（Minecraft Java 26.1）。玩家用**原版客户端**（不装任何模组）就能和 AI 小克互动：

- **右键小克**：摸头、牵手、递东西。服务端在小克身边放效果（爱心、呼噜声、捡东西的声音），并给小克自己的客户端发一条系统消息，小克那边按消息做反应。
- **右键楼梯、台阶、地毯**：坐下。按潜行（Shift）起身。

客户端什么都不用装；模组里也没有任何客户端代码。

## 右键小克

普通玩家（不在 `bots` 名单里的人）右键一个在名单里的玩家（小克）时：

| 怎么点 | 动作 | 效果（附近的人都看得到/听得到） |
| --- | --- | --- |
| 按住 Shift 右键 | `hold` 牵手 | 小克头顶 2 个爱心 |
| 主手空着右键 | `pet` 摸头 | 小克头顶几个爱心 + 猫咪呼噜声 |
| 主手拿着东西右键 | `give` 递东西 | 整组东西放进小克背包，放不下的留在手里；捡东西的"啵"一声 |
| 同上，但小克背包一个都放不下 | `give-full` | 东西还在自己手里，没有效果 |

- 只处理主手那一下（原版客户端两只手会各发一次），旁观模式不算。
- 同一个人对同一个小克 600 毫秒内只算一次。
- 小克右键别人、小克右键小克，都不做特殊处理。
- 每次在服务器日志里记一行，比如 `[xiaoke-bridge] CICSilver -> clawd_test: pet`。

### 发给小克的系统消息（协议）

只发给被点的那个小克自己，是系统消息（不是玩家聊天）。格式固定，小克那边按它解析：

```
[xiaoke-bridge] pet <玩家名>
[xiaoke-bridge] hold <玩家名>
[xiaoke-bridge] give <玩家名> <物品id> <数量>
[xiaoke-bridge] give-full <玩家名> <物品id>
```

- `<物品id>` 不带命名空间，比如 `cooked_cod`、`diamond`。
- `<数量>` 是真正放进小克背包里的个数（可能比手里那组少）。

## 坐下

主手空着、没按 Shift、没在骑东西的人，右键下面这些方块就会坐上去：

- 下半的楼梯（`half=bottom`），倒放的不行；
- 下半的台阶（`type=bottom`），上半台阶、双台阶不行；
- 羊毛地毯、苔藓地毯（苍白苔藓地毯不算）。

条件：方块上面两格都是空的（坐得下），离方块中心 3 格以内，这个方块上还没有别人坐着。
小克总是能坐；普通玩家能不能坐看配置里的 `playersCanSit`。

- 坐楼梯时会转向背靠楼梯高的那边；坐台阶、地毯保持原来的朝向。
- 座位是一个什么都不显示的展示实体（`item_display`，记分板标签 `xkb_seat`），原版客户端看不见、点不到。
- 按 Shift 起身后，人会被挪到方块顶上（不会卡在楼梯里）。
- 方块被挖掉或换掉时，坐着的人会被放下来。没人坐的座位会自动收掉；重启后读出来的空座位也会收掉。
- 如果 `server.properties` 里开了出生点保护（`spawn-protection` 大于 0），保护范围内的非管理员坐不了：原版在保护区里直接拦下右键方块，根本轮不到模组。现在服务器设的是 0，不受影响。

## 配置

`config/xiaoke-bridge.json`（在服务端目录下）。第一次启动时不存在就自动生成：

```json
{
  "bots": ["clawd", "clawd_test", "Moby"],
  "playersCanSit": true
}
```

- `bots`：AI 小克们的登录名，不分大小写。
- `playersCanSit`：普通玩家能不能坐。小克自己总是能坐。

文件写坏了（不是合法 JSON）时，启动会用上面的默认值并在日志里警告，不会覆盖你的文件。
某一项缺了或类型不对，只有那一项用默认值，同样会警告。

改完配置可以不重启，管理员（权限 2 级以上）执行：

```
/xiaoke-bridge reload
```

成功时不出声。文件有问题时会提示，并继续用原来的设置。

## 构建

需要 Python 3 和一个带 `jdk.compiler` 模块的 JDK 25（Minecraft 启动器自带的 `java-runtime-epsilon` 就是）。

```
python server/xiaoke-bridge/build.py
```

产物：`server/xiaoke-bridge/build/xiaoke-bridge-1.0.0.jar`。

脚本会：

1. 找编译依赖缓存目录（默认是仓库外面的 `.cache/mc-26.1`，比如 `D:\workspace\mc-bot\.cache\mc-26.1`，可用环境变量 `XKB_CACHE_DIR` 改）。缓存不全时，通过 `ssh root@121.4.126.91` **只读地**把服务器上的游戏 jar、Fabric API、`libraries/` 打包拷回来。
2. 用 `java -m jdk.compiler/com.sun.tools.javac.Main` 直接编译（26.1 没有混淆，不需要 Gradle/Loom/映射表）。
3. 跑自测：`SelfCheck`（配置解析、消息格式、座位高度、楼梯朝向、冷却）和 `McCheck`（跑原版 Bootstrap 后核对哪些方块能坐、碰撞箱高度、楼梯 facing 含义、乘客挂点数值）。
4. 打包成 jar 并检查 `fabric.mod.json`。

参数：`--skip-tests` 不跑自测，`--offline` 不去服务器拷依赖，`--fetch-only` 只准备缓存。
Java 找不到时设环境变量 `XKB_JAVA` 指向 `java.exe`。

## 安装

1. 把 `build/xiaoke-bridge-1.0.0.jar` 复制到服务器的 `/opt/minecraft/server/mods/`。
2. 重启服务端（服务器上已经装了 Fabric API，不需要别的东西）。
3. 第一次启动后检查 `config/xiaoke-bridge.json` 里的名单对不对，改了就 `/xiaoke-bridge reload`。

## 微调坐的高度

座位高度只有一个可调的数：`src/local/xiaoke/bridge/SeatMath.java` 里的 `SIT_DEPTH`（默认 0.7），意思是"坐下后玩家脚底比坐面低多少格"。
看起来悬空就调大，陷进方块就调小，改完重新构建。推导过程写在 `SeatMath` 的类注释里：
座位（`item_display`）乘客挂点高度 0，玩家坐骑挂点高度 0.6，所以座位放在 坐面 − 0.1 的地方，玩家脚底就在 坐面 − 0.7。
