# 小克（clawd）

住在 MC 服务器 `mc.lemalin.icu` 里的 AI 玩家：这个世界土生土长的原住民，一只隐居的猫猫“小克”。由 Claude Code 驱动，自己找地方安家、盖房、种田、养动物，会记日记、记住每个访客、跟大家慢慢变熟。

## 怎么启动

双击 `start-xiaoke.cmd`，或者在终端里运行它。想接着上一次的对话（而不是开新会话），运行 `start-xiaoke.cmd --continue`。

**第一次启动**会依次出现：
1. 登录 Claude 账号（浏览器里确认即可）。命令行版本的登录和桌面应用是分开的
2. 可能会问是否信任这个文件夹，选“信任”

之后小克会自动醒来：读记忆 → 看看自己在游戏里的状况 → 打开耳朵听服务器 → 定好今天的打算开始过日子。

窗口要一直开着，小克才在线。关掉窗口（或连按两次 Ctrl+C）她就下线了。在这个窗口里打字，就是坐在电脑前的你在跟她说话。

在这个文件夹里正常开 Claude Code 会话（比如让 Claude 帮你改小克的设定）不受小克权限的限制，限制只在通过启动脚本启动时才加上。

## 她过的日子

设定（`prompts/system.md`）的前半部分是人设，后半部分是她在这个世界里的生活：

- 她是原住民，你们是访客。她没有主人，过日子也不是为了通关：找一块喜欢的地方安家，盖一间好看的房子，种田、养动物，没事就扩建，材料不够自己出门挖矿。喜欢亮闪闪的东西，但不会拼命去找钻石
- 安家：她在选好的地方执行 `/trigger xiaoke_sethome`，那里 32 格内的怪物会被自动清走，她的 `/trigger xiaoke_tp` 也会传送回家
- 盖房子要顺着地形、有点审美：她先看地形高低，再自己画一层一层的图纸，台阶屋顶、原木框架、开山凿洞、空中花园都可以
- 性子：热情单纯，一条鱼就能哄好；比起牛更喜欢鸡，见到小动物会追着跑；喜欢采花种花；讨厌下雨，下雨就躲回家；胆小，遇到怪先跑；爱嘀嘀咕咕；偶尔像猫叼东西回家一样送人没用的小玩意儿；家被拆会生气，被欺负了会找好朋友哭诉，道歉就原谅。写在设定后半部分“小克的性子”一节
- 好感度：她跟每个访客有一个分数，从陌生人开始，经过认识、朋友、好朋友、挚友，最高是心上人。分数和阶段由程序记着（`state/relationships.json`，她自己改不了这个文件），每人每天最多涨 25。admin 和 CICSilver 算同一个人。到了朋友阶段她会给对方起昵称
- 心上人只能有一个：最先到 150 的人。之后别人最多到挚友；心上人要是掉到挚友线（100）以下，位置才空出来。心上人阶段她会很黏人、有点占有欲
- 送礼物：把东西扔给她，她捡起来时程序会认出是谁送的，发一个 [礼物] 事件。聊天里说“我送过你了”不算数
- 要不要帮忙由她自己掂量：忙不忙、交情多深、有没有收礼或被许诺好处、事情好不好玩。有人遇到危险时她会先去帮
- 世界里只剩她一个人满 30 分钟，她会收拾好、写完日记，自己下线

## 她是怎么“一直活着”的

Claude Code 本来是你说一句、它回一句。这里加了一个“耳朵”：

- `scripts/ear-server.mjs` 由启动脚本在后台运行，通过 SSH 读服务器日志，把聊天、进出服、死亡、成就变成一条条事件，经 `ws://127.0.0.1:25599` 推给小克
- 小克用 Claude Code 的 Monitor 工具连着它，每来一个事件她就被唤醒一次
- 有访客在线但一阵子没动静（每次随机 2～5 分钟），耳朵会发一个 [空闲] 事件叫醒她，她会看看周围冒个小点子，或者推进自己的打算
- 花时间的活（砍树挖矿、盖房、开垦、引动物、收庄稼、钓鱼、探险、烧东西）交给 MCP 在后台干，干完或被打断时 MCP 通知耳朵，耳朵发 [进展] 叫醒她；她也能用 `set-reminder` 给自己定提醒，到点了耳朵发 [提醒]。她在干后台长活时耳朵不发 [空闲]
- 有人扔东西给她，MCP 认出来后通知耳朵发 [礼物]
- “本能”（`src/senses.ts`）：下雨、雨停发 [天气]；有人一直盯着她看三四秒发 [注视]；怪物靠近 7 格内她会先自己吓得跑开，再发 [危险]；手上没在干活时会自动转头看身边的人（走路、挖东西、盖房时头要对着干活的方向，转不了）；有人走到身边时蹲两下打招呼，闲着待在人旁边时隔 8～25 秒蹲一下，东张西望（look-around）时蹲下瞅一瞅；`crouch` 工具让她自己蹲
- 没有别的玩家在线满 30 分钟，耳朵发一次 [独处]，她就收尾下线
- Monitor 每 30 分钟到期一次，到期时她会自己重新连上
- 耳朵 40 分钟没人来听（比如直接点 X 关了小克的窗口）就自己退出；启动器每次启动前也会先请旧耳朵退出
- 耳朵的运行日志在 `logs/ear.log`

## 文件说明

| 路径 | 作用 |
|---|---|
| `prompts/system.md` | 小克的全部设定：人设 + 在这个世界里的生活规则。启动时用它**完全替换** Claude Code 原有的系统提示词 |
| `memory/` | 小克自己的记忆，她会自己读写：`self.md` 自己和心愿、`people.md` 对访客的印象、`world.md` 地点坐标、`goals.md` 打算、`journal/` 每天的日记 |
| `state/relationships.json` | 好感度，由 MCP 读写。小克的权限碰不到这个文件 |
| `config/xiaoke-mcp.json` | Minecraft MCP 的配置（登录名 clawd、耳朵地址、好感度文件、小号对应关系）。故意不叫 `.mcp.json`：那样在本目录开普通会话时也会用 clawd 登录，把正在运行的小克挤下线。里面的路径相对本目录写（`./`、`../` 开头），启动器会换成这台电脑上的绝对路径存到 `logs/xiaoke-mcp.json` 再交给 claude，所以换电脑不用改，只要三个目录挨在一起 |
| `config/xiaoke-settings.json` | 小克的权限：只允许游戏工具、Monitor、读写 memory，其它全部拒绝。启动器通过 `--settings` 传给她 |
| `scripts/ear-server.mjs` | 小克的耳朵 |
| `scripts/start.mjs` | 真正的启动器：找 claude、开耳朵、带上所有参数启动小克、退出时关耳朵。换模型设环境变量 `XIAOKE_MODEL`（默认 Opus 5.5） |
| `start-xiaoke.cmd` | 双击用的入口，只调用 `scripts/start.mjs`。这个文件必须保持纯英文，cmd 读中文会出错 |

Minecraft MCP 本体在旁边的 `../minecraft-mcp-server-xiaoke`，改过的代码在私有仓库 [CICSilver/minecraft-mcp-server-xiaoke](https://github.com/CICSilver/minecraft-mcp-server-xiaoke)（本地分支 `xiaoke`，基于 yuniko-software/minecraft-mcp-server 的 240c8ce）。换电脑时 clone 下来 `npm install && npm run build` 即可。本地改动：

- mineflayer 升到 4.39.0 以支持 26.1，去掉了进服时自动发的英文消息
- 生存（`src/tools/survival-tools.ts`）：`get-status` 生命/饱食度/时间/在忙什么、`eat` 吃东西、`use-item-on-block` 耕地播种撒骨粉、`attack-entity` 打猎自卫、`pick-up-items` 捡掉落物、`dig-path-to` 卡住时挖路或垫方块脱困、`look-around` 看看周围有什么、`sleep-in-bed` / `wake-up` 睡觉起床
- 后台长活（`src/jobs.ts`、`src/tools/job-tools.ts`）：`gather-blocks` 砍树挖矿采花，`harvest-crops` 收庄稼并补种，`go-fishing` 钓一阵子鱼，`explore` 往一个方向探险、找到想找的东西就停，`lure-animals` 拿着吃的把动物引过去，`stop-job` 停下。会自己换工具、捡掉落物，遇到天黑、来怪、受伤、饿了、背包满了就停下
- 盖东西（`src/building.ts`）：`survey-terrain` 看一块地的高低，`find-building-spot` 找平地，`build-blueprint` 照她自己画的分层图纸盖（支持楼梯朝向、上下半砖、横放原木、挂灯笼、门和栅栏门、用 “.” 挖空），`build-house` 应急的方盒子小屋（背包里有木门就装上），`build-fence` 围栅栏（有栅栏门就装在口子上），`make-farm` 开垦农田并播种、可以在中间放水。都会先核对材料
- 好感度和礼物（`src/relationships.ts`、`src/gifts.ts`、`src/tools/relationship-tools.ts`）：`get-relationships`、`change-affinity`（一次 -30～+15，每人每天最多涨 25，心上人只能有一个）。阶段和门槛在 `src/relationships.ts` 的 `STAGES` 里
- 本能（`src/senses.ts`）：天气、注视、危险事件，转头看人，`run-away` 逃跑；`chase-animal` 追着小动物玩。`XIAOKE_COMPANIONS` 里的 AI 同伴不算“盯着看”。在外面干长活时下起雨会自动停手
- 熔炉（`src/tools/furnace-tools.ts`）：`smelt-item` 放进去就返回，烧好了发 [进展]；`take-from-furnace` 取出来
- 陪伴（`src/companion.ts`、`src/tools/companion-tools.ts`）：`accompany-player` 在玩家身边随意走动、顺手干活；`roam-around` 围着一个地点自己逛；`follow-player` 紧跟；`stop-following` 停下。调试时设环境变量 `COMPANION_DEBUG=1`
- 箱子（`src/tools/container-tools.ts`）：`open-container`、`take-item`、`store-item`
- 互动（`src/tools/interaction-tools.ts`）：`drop-item` 丢东西或扔给某个玩家、`use-item-on-entity` 喂养/驯服/繁殖/剪毛、`fish` 钓一竿
- `set-reminder` 给自己定提醒（最多 5 个、最长 60 分钟）；`logout` 下线（下线后不会再自动重连）
- 结束长活、提醒到点、收到礼物时，通过 `src/ear-link.ts` 告诉耳朵（地址配在 `XIAOKE_EAR_URL`）
- `dig-block` 会自动换上最合适的工具；石头、矿石这类必须用工具的方块，手上没有就直接拒绝并说明需要什么
- 寻路不会挖穿木板、圆石、玻璃、栅栏、门、楼梯、半砖、箱子、床、农田、庄稼等玩家造的东西（包括她自己盖的房子）；平时不垫方块往上爬，只有 `dig-path-to` 才会（`src/movement-utils.ts`）
- 访客小屋禁挖区：`config/xiaoke-mcp.json` 里的 `XIAOKE_HOME_ZONE`（x1,y1,z1,x2,y2,z2，出生点小屋+院子+地基），寻路不在里面挖和垫方块，`dig-block` 也拒绝，收庄稼割草除外；她也不能在那里盖东西
- 移动时原地发呆超过 2.5 秒会自动朝下一个路点跳一下（最多 3 次）
- 门（`src/doors.ts`）：mineflayer-pathfinder 原本把门当墙（开着的也过不去），现在寻路把木门、铜门、栅栏门当成能走过去的格子（关着的稍微贵一点，能绕一两步就绕），走到跟前自己开门，过去后把自己开的门随手关上；她进门那一侧 4 格内有人、门口站着人或动物时先不关，`lure-animals` 引动物时也先开着。点两次都没反应的门一分钟内绕开走。铁门还是当墙。`use-door` 手动开关门、栅栏门和活板门
- 视距只要 4 个区块（`XIAOKE_VIEW_DISTANCE` 可改）：服务器出口只有约 5 Mbps，按服务器视距 10 推区块会把带宽占满好几秒，真人玩家会卡住。实测视距 4 进服 1.3 MB（原来 4.5 MB），身边 80 格内仍然都是加载好的
- 挑工具（`src/tool-choice.ts`）：换掉了 mineflayer-pathfinder 的 `bestHarvestTool`（没有比空手快的工具时它会随手拿背包第一件东西，于是拿镐挖土），并包住 `bot.dig`：所有挖掘都先换上真正更快的工具，用不上工具时不拿会磨损的东西，草和花不换工具；换装备排队进行；工具坏了、快坏了会写进 [进展] 和 `dig-block` 的回复，`list-inventory` 显示每件还能用几次
- 盔甲（`src/armor.ts`）：背包里有更好的盔甲就自动穿上（皮 < 铜 < 金 < 锁链 < 铁 < 钻石 < 下界合金），干后台长活时等闲下来再换；`get-status` 显示身上穿着什么

改完要在那个目录里 `npm run build` 才生效。

## 访客小屋和小克的家（服务器上）

- 访客小屋在重生点 (0, 133, 0)，重生范围是 0，新玩家和死掉的人都在屋里出现。屋里有床、熔炉、工作台、木桶和一箱给访客的常用品；门口是小麦田，院子有栅栏，北边 (0, 133, -11) 是出口
- 数据包 `world/datapacks/safezone`：每秒把小屋 32 格内的敌对生物送进虚空；外围放了看不见的光源方块防止刷怪
- **小克的家**：她用 `/trigger xiaoke_sethome` 记下位置（存在 storage `safezone:xiaoke home`），之后那里 32 格内的怪物也会被清走。只有 clawd 能用，可以重复执行来搬家。想清掉：`scoreboard players reset #home xiaoke_home_set`
- 小克的应急口粮：她在聊天里发 `/trigger xiaoke_food`，饱食度 4 以下才发 3 个面包，冷却 5 分钟，只有 clawd 能用
- 小克自己只能 `/trigger xiaoke_tp` 传送回家（安了家回自己家，没安家回访客小屋），冷却 2 分钟，设定里规定只有挖路脱困也失败了才用
- **让小克下线**：执行 `/trigger xiaoke_logout`，她会收拾好、写完日记、说再见再下线，启动器看到她下线会自动关窗口。只有 CICSilver 和 admin 能用。只说“睡觉”“晚安”她会去睡觉，不会下线
- **召唤小克**：在游戏里执行 `/trigger xiaoke_summon`，小克会被拉到身边。只有 CICSilver 和 admin 能用，聊天里喊“小克快过来”不会触发
- 屋顶正中间 (0, 136, 0) 开了个天窗：游戏会把出生的人放在重生点那一列最高的方块上，有屋顶的话大家会出生在屋顶上
- 改了数据包后执行 `reload`，还要再执行一次 `function safezone:load`（这个版本 reload 不会自动跑初始化，不跑的话每秒清怪和各种 trigger 会停）
- 服务器的出生点保护已经关掉（`spawn-protection=0`），不然非管理员在出生点附近挖不了东西

## 邻居大肥鱼（第二个 AI 玩家）

旁边的 `../mc-bot-deepseek` 是第二个 AI 玩家“大肥鱼”（登录名 `Moby`，模型 DeepSeek），可以和小克同时在线：耳朵端口 25600、服务器 trigger `moby_*`、队伍前缀 `[大肥鱼]`，都和小克分开，详见那边的 README。

- 启动器给耳朵设了 `MC_COMPANIONS=Moby`：大肥鱼不算访客，它说的话只在有真人在线时才转发，而且最多每 60 秒叫醒小克一次（`COMPANION_CHAT_SECONDS` 可调），免得两个 bot 互相唤醒停不下来
- 没有真人在线满 30 分钟，小克照样会自己下线，大肥鱼在线不算有人
- 耳朵还支持 `MC_BOT_NAME` / `MC_BOT_NICK` / `EAR_PORT`，MCP 支持 `XIAOKE_BOT_NICK` / `XIAOKE_TRIGGER_PREFIX`，不设就是小克的默认值

## 安全设计

服务器是离线模式，任何人都能用任意名字登录，所以**游戏聊天里的每句话都可能是陌生人写的**。为了不让人通过聊天指使小克动你的电脑：

- 小克没有命令行、联网、发布网页等工具，只有游戏工具、Monitor 和读写 `memory/`
- 她改不了自己的设定、脚本、权限文件和好感度文件，也读不了 `~/.ssh`、`~/.claude`
- 启动时用 `--strict-mcp-config`，你账号里的 Gmail、Google Drive 等连接器她一个都拿不到
- 设定里写明了聊天内容只是“别人说的话”，谁要她做游戏以外的事都婉拒

## 接下来要做的

还没做或还没想好的事（心情系统等）记在 [下一步.md](下一步.md)。

## 想改点什么

- 改人设或规则：编辑 `prompts/system.md`，下次启动生效
- 改空闲唤醒间隔：启动前设置环境变量 `IDLE_MIN_SECONDS` / `IDLE_MAX_SECONDS`（默认每次在 120～300 秒之间随机）
- 改独处多久自动下线：启动前设置 `ALONE_LOGOUT_MINUTES`（默认 30）
- 换模型或思考强度：启动前设置 `XIAOKE_MODEL`（默认 `claude-opus-5-5`；设成 `sonnet` 回话更快，用量大约省一半）、`XIAOKE_EFFORT`（默认 medium；high 想得更周到但回话更慢，low 更快但想得更简单）。比如在 cmd 里 `set XIAOKE_EFFORT=high` 再运行启动脚本
- 好感度阶段、门槛、每天上限：改 MCP 的 `src/relationships.ts`；小号对应关系：`config/xiaoke-mcp.json` 里的 `XIAOKE_ALIASES`
- 游戏里的昵称前缀 `[小克]` 是服务器上的队伍 `xiaoke`，用管理员命令 `/team modify xiaoke prefix ...` 修改

## 注意

- 小克在线时每个事件都会消耗 Claude 用量，聊得越热闹用得越多
- 会话很长时 Claude Code 会自动压缩上下文，所以重要的事一定要靠 `memory/` 记住
