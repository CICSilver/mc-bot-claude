import { existsSync, lstatSync, mkdirSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const AGY_RUNTIME = join(ROOT, '.runtime', 'layers');
export const DEFAULTS = {
  fast: { model: 'gemini-3.8-flash', effort: 'low' },
  exec: { model: 'gemini-3.8-flash', effort: 'medium' },
  mind: { model: 'gemini-3.8-flash', effort: 'high' },
  planner: { model: 'gemini-4-argon', effort: 'medium' },
};

export function normalizeModel(model) {
  return String(model ?? '').trim().replace(/-(low|medium|high|xhigh|max)$/i, '');
}

export function findAgy() {
  const exe = process.platform === 'win32' ? 'agy.exe' : 'agy';
  const candidates = [];
  if (process.env.XIAOKE_AGY_BIN) candidates.push(process.env.XIAOKE_AGY_BIN);
  for (const dir of (process.env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':').filter(Boolean)) {
    candidates.push(join(dir, exe));
  }
  if (process.env.LOCALAPPDATA) candidates.push(join(process.env.LOCALAPPDATA, 'agy', 'bin', 'agy.exe'));
  const userHome = process.env.USERPROFILE || process.env.HOME;
  if (userHome) {
    candidates.push(join(userHome, 'AppData', 'Local', 'agy', 'bin', 'agy.exe'));
    candidates.push(join(userHome, '.local', 'bin', exe));
  }
  const found = candidates.find(p => p && existsSync(p));
  if (!found) throw new Error('找不到 agy 可执行文件，请先安装 Antigravity CLI。');
  return found;
}

export function childEnv(extra = {}) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !/^(CODEX_|OPENAI_|ANTHROPIC_|CLAUDE)/.test(key))
  );
  return { ...env, ...extra };
}

export function layerOptions(layer, config = {}) {
  if (!DEFAULTS[layer]) throw new Error('未知层');
  const value = key =>
    process.env[`XIAOKE_${layer.toUpperCase()}_${key.toUpperCase()}`] ||
    config.layers?.[layer]?.[key] ||
    DEFAULTS[layer][key];
  const rawModel = value('model');
  const effort = value('effort');
  return { model: normalizeModel(rawModel), effort };
}

export function normalizeMcpTool(stepUpdate = {}) {
  const toolName = stepUpdate.tool_name || stepUpdate.tool_info?.name || '';
  const params = stepUpdate.tool_info?.parameters ?? {};
  const output = stepUpdate.tool_info?.output;
  const error = stepUpdate.tool_info?.error ?? null;
  if (toolName === 'call_mcp_tool') {
    const rawServer = String(params.ServerName ?? '');
    const server = rawServer.replace(/_(fast|exec|mind|planner)$/, '') || rawServer;
    const tool = String(params.ToolName ?? '');
    const args = params.Arguments ?? {};
    const isError = Boolean(error) || (typeof output === 'string' && /^MCP error|error:/i.test(output.trim()));
    return {
      isMcp: true,
      server,
      rawServer,
      tool,
      arguments: args,
      hookTool: server === 'files' ? tool : `mcp__${server}__${tool}`,
      result: output !== undefined ? { content: [{ type: 'text', text: String(output) }], isError } : null,
      error,
    };
  }
  return {
    isMcp: false,
    server: 'builtin',
    rawServer: 'builtin',
    tool: toolName,
    arguments: params,
    hookTool: toolName,
    result: output !== undefined ? { content: [{ type: 'text', text: String(output) }], isError: Boolean(error) } : null,
    error,
  };
}

function linkDirIfPresent(target, linkPath) {
  try {
    const stat = lstatSync(linkPath);
    if (stat.isSymbolicLink()) unlinkSync(linkPath);
    else return;
  } catch {}
  if (!existsSync(target)) return;
  try {
    symlinkSync(target, linkPath, 'junction');
  } catch {}
}

export function ensureRuntime() {
  mkdirSync(AGY_RUNTIME, { recursive: true });
}

export function makeProfile({ layer, home, promptFile, bodyUrl, options, conversationId, enableMinecraftMcp = true }) {
  if (!DEFAULTS[layer]) throw new Error(`未知层: ${layer}`);
  const prompt = readFileSync(promptFile, 'utf8');
  if (!prompt.trim()) throw new Error('提示词为空，拒绝使用默认提示词。');

  const resolvedHome = resolve(home);
  const layerCwd = join(AGY_RUNTIME, layer);
  const agentsDir = join(layerCwd, '.agents', 'agents');
  mkdirSync(agentsDir, { recursive: true });
  mkdirSync(join(resolvedHome, 'buildings'), { recursive: true });
  mkdirSync(join(resolvedHome, 'state'), { recursive: true });

  for (const sub of ['memory', 'buildings', 'state', '手册', '参考']) {
    linkDirIfPresent(join(resolvedHome, sub), join(layerCwd, sub));
  }
  if (!existsSync(join(resolvedHome, '手册'))) {
    linkDirIfPresent(join(ROOT, 'prompts', '系统', '手册'), join(layerCwd, '手册'));
  }
  if (!existsSync(join(resolvedHome, '参考'))) {
    linkDirIfPresent(join(ROOT, 'prompts', '小克', '参考'), join(layerCwd, '参考'));
  }
  linkDirIfPresent(join(ROOT, 'prompts'), join(layerCwd, 'prompts'));

  const mcpServers = {
    [`files_${layer}`]: {
      command: process.execPath,
      args: [join(ROOT, 'scripts', 'file-tools.mjs'), layer, resolvedHome],
    },
  };
  if (enableMinecraftMcp && bodyUrl) {
    mcpServers[`minecraft_${layer}`] = {
      serverUrl: `${bodyUrl.replace(/\/+$/, '')}/mcp/${layer}`,
    };
  }
  const mcpConfigPath = join(layerCwd, '.agents', 'mcp_config.json');
  writeFileSync(mcpConfigPath, JSON.stringify({ mcpServers }, null, 2));

  const agentName = `xiaoke-${layer}`;
  const roleLabel = { fast: '小克快速反应层', exec: '小克执行脑', mind: '小克轻型调度脑', planner: '小克重型规划脑' }[layer];
  const agyToolGuide = [
    '---',
    '## Agy CLI 工具调用约束与参数速查（重要，直接照此传参，无需读取 ~/.gemini/antigravity-cli/mcp 下的 json schema）',
    `- 游戏身体工具统一通过 \`call_mcp_tool\` 调用 \`ServerName: "minecraft_${layer}"\`。`,
    `- 本地文件读写与日记工具统一通过 \`call_mcp_tool\` 调用 \`ServerName: "files_${layer}"\`：`,
    '  - 读取文本或图片：`ToolName: "Read"`，`Arguments: {"path": "memory/self.md"}`',
    ...(layer === 'mind'
      ? [
          '  - 修改记忆文件：`ToolName: "Edit"`，`Arguments: {"path": "memory/goals.md", "old_string": "原文", "new_string": "新内容"}`',
          '  - 追加日记：`ToolName: "AppendJournal"`，`Arguments: {"date": "YYYY-MM-DD", "text": "日记内容"}`',
          '- 决策脑常用 `minecraft_mind` 工具参数签名（直接传参，无需查 schema）：',
          '  - `get-status`: `{}` | `get-tasks`: `{}` | `get-position`: `{}` | `list-inventory`: `{}` | `look-around`: `{}` | `get-relationships`: `{}`',
          '  - `assign-task`: `{"goal": "做什么", "doneWhen": "完成标准", "allowed": "允许使用的材料与范围", "askWhen": "可选，何种情况先回来问", "blueprint": "可选，已保存的图纸名"}`',
          '  - `cancel-task`: `{"id": 任务数字ID, "reason": "取消原因"}`',
          '  - `pass-to-mouth`: `{"to": "玩家名", "say": "沟通要点"}`',
          '  - `share-plan`: `{"plan": "打算概要", "waitingFor": "可选，等待的东西"}`',
          '  - `change-affinity`: `{"player": "玩家名", "amount": 整数变化量, "reason": "中文原因"}`',
          '  - `feel`: `{"happy": 整数变化, "tense": 整数变化, "who": "玩家名", "reason": "中文原因"}`',
          '  - `request-plan`: `{"brief": "设计目标、地点、材料、喜好"}` | `cancel-plan`: `{"reason": "取消原因"}`',
          '  - `stop-work`: `{"action": "pause 或 cancel 或 logout", "reason": "玩家原话与意图"}` | `resume-work`: `{}`',
          '  - `logout`: `{"note": "未完事项与下一步"}`：一次保存日记并下线。快层已道别时直接调用。',
        ]
      : []),
    ...(layer === 'exec'
      ? [
          '- 执行脑常用 `minecraft_exec` 工具参数签名（直接传参，无需查 schema）：',
          '  - `get-status`: `{}` | `get-position`: `{}` | `list-inventory`: `{}` | `get-task`: `{}` | `pick-up-items`: `{}`',
          '  - `report-task`: `{"id": 任务数字ID, "kind": "done" | "stuck" | "waiting" | "failed" | "progress", "text": "汇报内容", "tried": "卡住或失败时写已尝试的方法"}`',
          '  - `move-to-position`: `{"x": X, "y": Y, "z": Z, "range": 1, "timeoutMs": 5000}`',
          '  - `open-container`: `{"x": X, "y": Y, "z": Z}` | `take-item`: `{"x": X, "y": Y, "z": Z, "item": "物品ID", "count": 数量}` | `store-item`: `{"x": X, "y": Y, "z": Z, "item": "物品ID", "count": 数量}`',
          '  - `craft-item`: `{"outputItem": "物品ID", "amount": 合成次数}`；按配方产量换算次数，例如4根木棍只合成1次。`place-block`: `{"x": X, "y": Y, "z": Z, "block": "方块ID"}`',
          '  - `make-farm`: `{"x1": 最小X, "z1": 最小Z, "x2": 最大X, "z2": 最大Z, "crop": "wheat_seeds", "waterInMiddle": false}`',
          '  - `murmur`: `{"text": "头顶嘀咕文字", "emote": "可选动作名"}`',
          '  - `do-steps`: `{"title": "步骤标题", "steps": [{"tool": "工具名", "args": {...}}]}`',
        ]
      : []),
    ...(layer === 'fast'
      ? [
          '- 快层常用 `minecraft_fast` 工具参数签名（直接传参，无需查 schema）：',
          '  - `send-chat`: `{"message": "聊天内容", "toward": "玩家名", "emote": "可选动作如wave/happy/bounce/shy/sparkle"}`',
          '  - `murmur`: `{"text": "头顶自言自语", "emote": "可选动作"}`',
          '  - `note-for-later`: `{"note": "记给决策脑的事项", "urgent": true或false}`',
          '  - `stop-work`: `{"action": "pause 或 cancel 或 logout", "reason": "玩家原话与意图"}`；玩家叫停或下线时先调用，再回应聊天。',
          '  - `change-affinity`: `{"player": "玩家名", "amount": 整数变化量, "reason": "中文原因"}`',
        ]
      : []),
    ...(layer === 'planner' ? [
      '- 规划脑常用 `minecraft_planner` 工具参数签名（直接传参，无需查 schema）：',
      '  - `save-blueprint`: `{"name": "图纸名", "x": 西侧X, "y": 底层Y, "z": 北侧Z, "palette": {"字符": "方块ID"}, "layers": [["..."]], "note": "说明"}`',
      '  - `report-plan`: `{"id": 收到的规划编号, "summary": "方案、图纸名、材料与分段建议"}`',
      '  - `get-block-info`: `{"x": X, "y": Y, "z": Z}` | `get-status`: `{}` | `get-position`: `{}` | `list-inventory`: `{}`',
    ] : []),
    '- 文件与世界操作通过本层 MCP 工具完成。',
  ].join('\n');

  const agentFile = join(agentsDir, `${agentName}.md`);
  const agentDoc = [
    '---',
    `name: ${agentName}`,
    `description: ${roleLabel}`,
    'mainAgent: true',
    'subagent: false',
    'commandExecutionPolicy: off',
    '---',
    '',
    prompt.trim(),
    '',
    agyToolGuide,
    '',
  ].join('\n');
  writeFileSync(agentFile, agentDoc);

  const model = normalizeModel(options.model);
  const args = [
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--dangerously-skip-permissions',
    '--disable-slash-commands',
    '--agent', agentName,
    '--model', model,
    '--effort', options.effort,
    ...(conversationId ? ['--conversation', conversationId] : []),
  ];

  return {
    args,
    prompt,
    layerCwd,
    mcpConfigPath,
    agentFile,
    agentName,
  };
}
