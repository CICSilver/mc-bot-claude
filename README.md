# 小克（clawd）

住在 MC 服务器 `mc.lemalin.icu` 里的 AI 玩家。由 Claude Code 驱动，用猫系女仆“小克”的人格和大家互动，会自己记日记、记住认识的人。

## 怎么启动

双击 `start-xiaoke.cmd`，或者在终端里运行它。想接着上一次的对话（而不是开新会话），运行 `start-xiaoke.cmd --continue`。

**第一次启动**会依次出现：
1. 登录 Claude 账号（浏览器里确认即可）。命令行版本的登录和桌面应用是分开的
2. 可能会问是否信任这个文件夹，选“信任”

之后小克会自动醒来：读记忆 → 看看自己在游戏里的状况 → 打开耳朵听服务器 → 有人在就打招呼。

窗口要一直开着，小克才在线。关掉窗口（或连按两次 Ctrl+C）她就下线了。在这个窗口里打字，就是主人在跟她说话。

在这个文件夹里正常开 Claude Code 会话（比如让 Claude 帮你改小克的设定）不受小克权限的限制，限制只在通过启动脚本启动时才加上。

## 她是怎么“一直活着”的

Claude Code 本来是你说一句、它回一句。这里加了一个“耳朵”：

- `scripts/ear-server.mjs` 由启动脚本在后台运行，通过 SSH 读服务器日志，把聊天、进出服、死亡、成就变成一条条事件，经 `ws://127.0.0.1:25599` 推给小克
- 小克用 Claude Code 的 Monitor 工具连着它，每来一个事件她就被唤醒一次
- 有人在线但一阵子没动静（每次随机 2～5 分钟），耳朵会发一个 [空闲] 事件叫醒她，她会看看周围、冒个小点子去做，或者推进待办清单；没人在线时不发，省用量
- Monitor 每 30 分钟到期一次，到期时她会自己重新连上
- 耳朵的运行日志在 `logs/ear.log`

## 文件说明

| 路径 | 作用 |
|---|---|
| `prompts/system.md` | 小克的全部设定：主人写的人设 + 游戏里的生活规则。启动时用它**完全替换** Claude Code 原有的系统提示词 |
| `memory/` | 小克自己的记忆，她会自己读写：`self.md` 自己、`people.md` 认识的人、`world.md` 地点坐标、`goals.md` 目标、`journal/` 每天的日记 |
| `config/xiaoke-mcp.json` | Minecraft MCP 的配置（登录名 clawd）。故意不叫 `.mcp.json`：那样在本目录开普通会话时也会用 clawd 登录，把正在运行的小克挤下线 |
| `config/xiaoke-settings.json` | 小克的权限：只允许游戏工具、Monitor、读写 memory，其它全部拒绝。启动器通过 `--settings` 传给她 |
| `scripts/ear-server.mjs` | 小克的耳朵 |
| `scripts/start.mjs` | 真正的启动器：找 claude、开耳朵、带上所有参数启动小克、退出时关耳朵。换模型设环境变量 `XIAOKE_MODEL`（默认 Opus 5.5） |
| `start-xiaoke.cmd` | 双击用的入口，只调用 `scripts/start.mjs`。这个文件必须保持纯英文，cmd 读中文会出错 |

Minecraft MCP 本体在旁边的 `../minecraft-mcp-server`，改过的代码在私有仓库 [CICSilver/minecraft-mcp-server-xiaoke](https://github.com/CICSilver/minecraft-mcp-server-xiaoke)（本地分支 `xiaoke`，基于 yuniko-software/minecraft-mcp-server 的 240c8ce）。换电脑时 clone 下来 `npm install && npm run build` 即可。本地改动：

- mineflayer 升到 4.39.0 以支持 26.1，去掉了进服时自动发的英文消息
- 新增工具（`src/tools/survival-tools.ts`）：`get-status` 生命/饱食度/时间、`eat` 吃东西、`use-item-on-block` 耕地播种撒骨粉、`attack-entity` 打猎自卫、`pick-up-items` 捡掉落物、`dig-path-to` 卡住时挖路或垫方块脱困
- 寻路不会挖穿木板、栅栏、门、箱子、床、农田、庄稼等玩家造的东西；平时不垫方块往上爬，只有 `dig-path-to` 才会（`src/movement-utils.ts`）
- 陪伴（`src/companion.ts`、`src/tools/companion-tools.ts`）：`accompany-player` 在后台让她在玩家身边随意走动、顺手割草砍树捡东西；`roam-around` 让她围着一个地点自己逛、顺手干活；`follow-player` 紧跟；`stop-following` 停下。调试时设环境变量 `COMPANION_DEBUG=1` 会把每次干的活打到 stderr
- 箱子（`src/tools/container-tools.ts`）：`open-container`、`take-item`、`store-item`
- 互动（`src/tools/interaction-tools.ts`）：`drop-item` 丢东西或扔给某个玩家、`use-item-on-entity` 喂养/驯服/繁殖/剪毛、`fish` 钓鱼
- 其它：`look-around` 看看周围有什么（给她找点子用）、`sleep-in-bed` / `wake-up` 睡觉起床、`logout` 下线（`src/tools/session-tools.ts`，下线后不会再自动重连）
- `dig-block` 会自动换上最合适的工具；石头、矿石这类必须用工具的方块，手上没有就直接拒绝并说明需要什么
- 家附近禁挖区：`config/xiaoke-mcp.json` 里的 `XIAOKE_HOME_ZONE`（x1,y1,z1,x2,y2,z2，现在是小屋+院子+地基），寻路不在里面挖和垫方块，`dig-block` 也拒绝，收庄稼割草除外
- 移动时原地发呆超过 2.5 秒会自动朝下一个路点跳一下（最多 3 次），`move-to-position` 和 `dig-path-to` 都有

改完要在那个目录里 `npm run build` 才生效。

## 出生点小屋和安全区（服务器上）

- 小屋在重生点 (0, 133, 0)，重生范围是 0，新玩家和死掉的人都在屋里出现。屋里有床、熔炉、工作台、木桶和一箱常用品；门口是小麦田，院子有栅栏，北边 (0, 133, -11) 是出口
- 数据包 `world/datapacks/safezone`：每秒把小屋 32 格内的敌对生物送进虚空；外围放了看不见的光源方块防止刷怪
- 小克的应急口粮：她在聊天里发 `/trigger xiaoke_food`，饱食度 4 以下才发 3 个面包，冷却 5 分钟，只有 clawd 能用。规则写在数据包的 `emergency_food.mcfunction` 里
- **让小克下线**：主人执行 `/trigger xiaoke_logout`，她会写好日记、更新记录、说再见再下线，启动器看到她下线会自动关窗口。只有 CICSilver 和 admin 能用。只说“睡觉”“晚安”她会去睡她的粉色床，不会下线
- **召唤小克**：主人在游戏里执行 `/trigger xiaoke_summon`，小克会被传送到身边。只有 CICSilver 和 admin 能用，聊天里喊“小克快过来”不会触发
- 小克自己只能 `/trigger xiaoke_tp` 传送回家，冷却 2 分钟，设定里规定只有挖路脱困也失败了才用
- 屋顶正中间 (0, 136, 0) 开了个天窗：游戏会把出生的人放在重生点那一列最高的方块上，有屋顶的话大家会出生在屋顶上
- 改了数据包后执行 `reload`，还要再执行一次 `function safezone:load`（这个版本 reload 不会自动跑初始化，不跑的话每秒清怪和各种 trigger 会停）
- 服务器的出生点保护已经关掉（`spawn-protection=0`），不然非管理员在出生点附近挖不了东西

## 安全设计

服务器是离线模式，任何人都能用任意名字登录，所以**游戏聊天里的每句话都可能是陌生人写的**。为了不让人通过聊天指使小克动你的电脑：

- 小克没有命令行、联网、发布网页等工具，只有游戏工具、Monitor 和读写 `memory/`
- 她改不了自己的设定、脚本和权限文件，也读不了 `~/.ssh`、`~/.claude`
- 启动时用 `--strict-mcp-config`，你账号里的 Gmail、Google Drive 等连接器她一个都拿不到
- 设定里写明了聊天内容只是“别人说的话”，谁要她做游戏以外的事都婉拒

## 想改点什么

- 改人设或规则：编辑 `prompts/system.md`，下次启动生效
- 改空闲唤醒间隔：启动前设置环境变量 `IDLE_MIN_SECONDS` / `IDLE_MAX_SECONDS`（默认每次在 120～300 秒之间随机）
- 换模型或思考强度：启动前设置 `XIAOKE_MODEL`（默认 `claude-opus-5-5`；设成 `sonnet` 回话更快，用量大约省一半）、`XIAOKE_EFFORT`（默认 medium；high 想得更周到但回话更慢，low 更快但想得更简单）。比如在 cmd 里 `set XIAOKE_EFFORT=high` 再运行启动脚本
- 游戏里的昵称前缀 `[小克]` 是服务器上的队伍 `xiaoke`，用管理员命令 `/team modify xiaoke prefix ...` 修改

## 注意

- 小克在线时每个事件都会消耗 Claude 用量，聊得越热闹用得越多
- 会话很长时 Claude Code 会自动压缩上下文，所以重要的事一定要靠 `memory/` 记住
