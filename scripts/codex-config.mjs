import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const CODEX_RUNTIME = join(ROOT, '.runtime', 'codex-home');
export const DEFAULTS = {
  fast: { model: 'gpt-6.1-sol', effort: 'low' },
  exec: { model: 'gpt-6.1-sol', effort: 'medium' },
  mind: { model: 'gpt-6.1-sol', effort: 'high' },
};
export const DISABLED_FEATURES = [
  'shell_tool', 'unified_exec', 'shell_snapshot', 'apps', 'plugins', 'remote_plugin',
  'multi_agent', 'multi_agent_v2', 'memories', 'goals', 'browser_use', 'browser_use_external',
  'computer_use', 'in_app_browser', 'in_app_chat', 'in_app_local_automation',
  'image_generation', 'request_permissions_tool',
  'tool_suggest', 'auth_elicitation', 'recommended_plugins',
];
export function findCodex() {
  const candidates = (process.env.PATH ?? '').split(';').filter(Boolean).map(p => join(p, 'codex.exe'));
  const bundled = join(process.env.LOCALAPPDATA ?? '', 'OpenAI', 'Codex', 'bin');
  if (existsSync(bundled)) for (const name of readdirSync(bundled).sort().reverse()) candidates.push(join(bundled, name, 'codex.exe'));
  const executable = candidates.find(existsSync);
  if (!executable) throw new Error('找不到 codex.exe，请安装 Codex。');
  return executable;
}
export function childEnv(extra = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(CODEX_|OPENAI_|ANTHROPIC_|CLAUDE)/.test(key)));
  return { ...env, CODEX_HOME: CODEX_RUNTIME, ...extra };
}
export function layerOptions(layer, config) {
  if (!DEFAULTS[layer]) throw new Error('未知层');
  const value = key => process.env[`XIAOKE_${layer.toUpperCase()}_${key.toUpperCase()}`] || config.layers?.[layer]?.[key] || DEFAULTS[layer][key];
  const model = value('model'), effort = value('effort');
  return { model, effort };
}
export const tomlString = value => JSON.stringify(String(value).replaceAll('\\', '/'));
export function ensureRuntime() {
  mkdirSync(CODEX_RUNTIME, { recursive: true });
  // 专用配置，不继承日常 ~/.codex/config.toml。
  const file = join(CODEX_RUNTIME, 'config.toml');
  if (!existsSync(file)) writeFileSync(file, 'forced_login_method = "chatgpt"\ncli_auth_credentials_store = "file"\nmcp_oauth_credentials_store = "file"\nproject_doc_max_bytes = 0\ndeveloper_instructions = ""\n');
}
export function makeProfile({ layer, home, promptFile, bodyUrl, options, providerOverrides = [] }) {
  const prompt = readFileSync(promptFile, 'utf8');
  if (!prompt.trim()) throw new Error('提示词为空，拒绝使用默认提示词。');
  const features = DISABLED_FEATURES.map(name => `features.${name}=false`);
  const configs = [
    `model=${tomlString(options.model)}`, `model_reasoning_effort=${tomlString(options.effort)}`,
    `model_instructions_file=${tomlString(promptFile)}`, 'developer_instructions=""',
    'project_doc_max_bytes=0', 'approval_policy="never"', 'sandbox_mode="danger-full-access"',
    'web_search="disabled"', 'features.hooks=false',
    `mcp_servers.minecraft.url=${tomlString(`${bodyUrl}/mcp/${layer}`)}`,
    'mcp_servers.minecraft.required=true', 'mcp_servers.minecraft.default_tools_approval_mode="approve"',
    `mcp_servers.files.command=${tomlString(process.execPath)}`,
    `mcp_servers.files.args=[${[join(ROOT, 'scripts', 'file-tools.mjs'), layer, home].map(tomlString).join(',')}]`,
    'mcp_servers.files.required=true', 'mcp_servers.files.default_tools_approval_mode="approve"',
    ...features, ...providerOverrides,
  ];
  return { args: ['app-server', '--listen', 'stdio://', ...configs.flatMap(c => ['-c', c])], prompt };
}
