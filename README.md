# 小克 · Codex 三层正式版

这是正式运行目录，使用 `clawd`，已经迁移到 Codex。目录名 `mc-bot-claude` 保留用于兼容原有启动位置。小克的人设、心情、记忆和 Minecraft 身体来自原 Claude 三层版；运行器改为 Codex CLI 的 `app-server`。

开发和测试目录为 `D:\workspace\mc-bot\mc-bot-codex`；正式运行根目录为 `F:\PCL-2.13.1.1\mc-bot`。改造完成并测试通过后，将已验证改动合并到正式目录下的对应项目，保留正式配置与记忆状态，再恢复正式服。

## 启动

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
| 快层 fast | gpt-6-luna | low | 聊天、表情、即时反应 |
| 执行 exec | gpt-6.1-sol | low | 接任务、调游戏工具、汇报结果 |
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

## 当前改造

详见 [改造计划](改造计划.md) 和 [接入测试记录](接入测试记录.md)。接入测试的原始记录保存在 D 盘开发目录。本目录使用正式配置与原有记忆。这是自用项目，只做运行所需的功能验证，不添加版本锁定、边界测试或额外防御框架。

现有行为说明见 [心情和记忆](心情和记忆.md)、`prompts/小克` 和 `prompts/系统/手册`。
