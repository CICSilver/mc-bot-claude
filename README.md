# 小克 · Codex 三层正式版

这是正式运行目录，使用 `clawd`，已经迁移到 Codex。目录名 `mc-bot-claude` 保留用于兼容原有启动位置。小克的人设、心情、记忆和 Minecraft 身体来自原 Claude 三层版；运行器改为 Codex CLI 的 `app-server`。

开发和测试目录为 `D:\workspace\mc-bot\mc-bot-codex`；正式运行根目录为 `F:\PCL-2.13.1.1\mc-bot`。改造完成并测试通过后，将已验证改动合并到正式目录下的对应项目，保留正式配置与记忆状态，再恢复正式服。

## 启动

发情累加默认关闭。CICSilver（含别名 admin）可以在游戏聊天中输入 `!发情 开`、`!发情 关` 或 `!发情 状态`，也可以私聊小克，例如 `/msg clawd !发情 关`。指令立即生效，小克私聊回报结果；开关随心情状态保存，重启后沿用。关闭时当前热度归零，再次开启从新的互动开始，普通心情和好感照常。

正式入口为 `F:\PCL-2.13.1.1\mc-bot\start-xiaoke.bat`。本目录里的 `start-xiaoke.bat` 和 `start-xiaoke.cmd` 也都启动 Codex。

首次授权（已完成过则跳过）：

```powershell
npm run login
```

打开三个运行窗口：

```powershell
.\start-xiaoke.cmd
```

接着上次的三层对话：

```powershell
.\start-xiaoke.cmd --continue
```

每个窗口都可以输入文字；输入 `/quit` 或关闭任一运行窗口，整组一起下线。测试时也可以用 `node scripts/start.mjs --headless --continue`，把三个控制器放在同一终端。

当前配置连接正式服 `mc.lemalin.icu:25565`，账号 `clawd`，身体端口 `25598`、耳朵端口 `25599`。正式服应为 `mc-active unit` 返回的 `minecraft`。启动器不会自动切服。

每轮改造或测试结束后，测试流程必须停止测试版小克、完成日志归档，再恢复正式服并确认 `mc-active unit` 返回 `minecraft`。具体约定见 [AGENTS.md](AGENTS.md)。

## 实时监控

```powershell
npm run watch
```

显示实际游戏发言、三层控制台输出、派活、执行汇报和日记写入。监控窗口可以单独关闭，不会停止机器人；运行器重启后它会继续跟踪新日志。

## 三层配置

| 层 | 默认模型 | 思考强度 | 职责 |
| --- | --- | --- | --- |
| 快层 fast | gpt-6.1-sol | low | 聊天、表情、即时反应 |
| 执行 exec | gpt-6.1-sol | medium | 接任务、调游戏工具、汇报结果 |
| 决策 mind | gpt-6.1-sol | high | 做打算、派活、写记忆和日记 |

修改 `config/xiaoke-body.json` 的 `layers`，或临时设置 `XIAOKE_FAST_MODEL`、`XIAOKE_EXEC_EFFORT` 等环境变量。配置直接交给 Codex，不设模型名单或 CLI 版本门槛。

可执行文件优先从 PATH 查找，找不到时使用桌面版附带的 `codex.exe`。实际运行的是后台 CLI，不需要操作 Codex 桌面界面。专用登录保存在 `.runtime/codex-home`，三层共享；各层 thread ID 保存在 `.runtime/session-*.json`。

## 提示词、事件和记忆

- `prompts/小克` 保留人格、生活和心情设定；`prompts/系统` 放分层职责和手册。
- 启动器生成 `logs/prompt-fast.md`、`prompt-exec.md`、`prompt-mind.md`，作为各层的基础指令。
- Node 控制器持续连接耳朵的 WebSocket。空闲时 `turn/start`，忙碌时 `turn/steer`，不需要 Monitor 或定时续期。
- 身体继续使用旁边的 `minecraft-mcp-server-xiaoke`；各层使用原来的 `/mcp/fast`、`/mcp/exec`、`/mcp/mind` 工具集。
- 正式记忆在本目录的 `memory`，运行状态在 `state`。文件工具 Read 读取文本、目录和图片；决策层用 Edit 更新记忆，用 AppendJournal 追加日记。
- 模型的控制台输出不自动发到游戏；游戏里说话由 `send-chat` 完成。

## 常用检查和日志

```powershell
npm run check                     # 生成三层提示词并检查本地配置
npm test                          # 事件处理及现有功能测试
npm run smoke -- fast             # 一次真实模型及记忆读取
npm run smoke -- mind --write     # 参考图片读取并追加一条测试日记
npm run smoke -- exec --game      # 身体已启动时，读取生命和位置
node scripts/measure.mjs          # 最近一局每层回合、工具和耗时
node scripts/cost.mjs             # 实际 token 与账号额度快照
```

`smoke` 使用真实订阅额度；它的会话与三层正式运行会话分开，结果在 `logs/smoke-*.json`。可加 `--continue` 验证测试会话续接。

`logs/fast.jsonl`、`exec.jsonl`、`mind.jsonl` 是控制器原始记录；`body.log` 和 `ear.log` 是身体与耳朵记录。结束一局后归档到 `logs/runs/<时间>_main_clawd`，并沿用原 SSH 连接上传到服务器独立目录 `~/xiaoke-codex-logs`。不读取 Claude 会话目录。

用量统计里的 token 是服务返回的会话累计值，续接包含之前的对话；账号额度也包含其它 Codex 会话，不换算成 API 账单。

### Agy 上下文日志

四层的 JSONL 日志新增以下记录，下线时沿用现有按局归档与上传流程：

- `step_usage`：步骤完成时的原始用量、会话号、回合号、步骤号、模型与耗时。`agent_response` 的非缓存输入加缓存输入为本次生成的输入量；缺失字段保留为 `null`。相同步骤的重复完成通知按会话号和步骤号去重统计。
- `checkpoint`：检查点开始、完成或失败，以及原始事件元数据。检查点摘要生成次数单列；历史压缩次数需由实际元数据确认，输入量下降和新建会话各自记录。
- `agy_init`、`agy_process_started`、`session_changed`、`conversation_reset_requested`：初始化、进程重启、会话切换与程序已知的重建原因。`agy_event`、`agy_step` 保留其余原始事件，方便核对后续版本的压缩通知。
- `usage`：继续保留会话累计用量，并补充会话号及 Agy 原始用量。`cost.mjs` 汇总每个会话最后一次累计值，保留重建前的用量，逐步骤样本不重复加进累计值。

```powershell
node scripts/measure.mjs logs/runs/<一局目录>  # 输入峰值、P95、缺失样本、检查点与会话重建
node scripts/cost.mjs logs/runs/<一局目录>     # 各会话累计消耗，单列缓存输入
```

占用比例使用明确列出的官方模型上限（Flash 3.8 输入上限、Argon 共享窗口），记录来源为 `model_spec`；未知模型仅报告 token 实数。该比例计算输入部分，输出另列；Agy 自动压缩阈值尚未上报。旧日志缺少逐步骤样本时显示缺失，保留其累计用量统计。

记录由控制器读取 Agy 原有输出，不追加提示词、不发起额外模型调用、不主动压缩或重建会话。上下文数据采集不参与游戏事件处理。

## 当前改造

详见 [改造计划](改造计划.md) 和 [接入测试记录](接入测试记录.md)。接入测试的原始记录保存在 D 盘开发目录。本目录使用正式配置与原有记忆。这是自用项目，只做运行所需的功能验证，不添加版本锁定、边界测试或额外防御框架。

现有行为说明见 [心情和记忆](心情和记忆.md)、`prompts/小克` 和 `prompts/系统/手册`。
