import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, makeProfile, normalizeModel, normalizeMcpTool } from './agy-config.mjs';

test('normalizeModel strips trailing effort suffixes', () => {
  assert.equal(normalizeModel('gemini-3.8-flash-medium'), 'gemini-3.8-flash');
  assert.equal(normalizeModel('gemini-4-argon-high'), 'gemini-4-argon');
  assert.equal(normalizeModel('gemini-3.8-flash'), 'gemini-3.8-flash');
});

test('normalizeMcpTool normalizes layer-suffixed MCP server names and hook tool names', () => {
  const fileStep = normalizeMcpTool({
    tool_name: 'call_mcp_tool',
    tool_info: {
      parameters: { ServerName: 'files_mind', ToolName: 'AppendJournal', Arguments: { date: '2026-10-17', text: '日记' } },
      output: 'ok',
    },
  });
  assert.equal(fileStep.isMcp, true);
  assert.equal(fileStep.server, 'files');
  assert.equal(fileStep.tool, 'AppendJournal');
  assert.equal(fileStep.hookTool, 'AppendJournal');

  const mcStep = normalizeMcpTool({
    tool_name: 'call_mcp_tool',
    tool_info: {
      parameters: { ServerName: 'minecraft_exec', ToolName: 'gather-blocks', Arguments: { block: 'oak_log' } },
      output: 'done',
    },
  });
  assert.equal(mcStep.isMcp, true);
  assert.equal(mcStep.server, 'minecraft');
  assert.equal(mcStep.tool, 'gather-blocks');
  assert.equal(mcStep.hookTool, 'mcp__minecraft__gather-blocks');
});

test('makeProfile writes isolated .agents/mcp_config.json with serverUrl and agent markdown', () => {
  const logsDir = join(ROOT, 'logs');
  mkdirSync(logsDir, { recursive: true });
  const promptFile = join(logsDir, 'prompt-fast.test.md');
  writeFileSync(promptFile, '# 测试提示词\n你是小克。');

  const profile = makeProfile({
    layer: 'fast',
    home: join(ROOT, '.runtime', 'test-home'),
    promptFile,
    bodyUrl: 'http://127.0.0.1:25613',
    options: { model: 'gemini-3.8-flash-low', effort: 'low' },
    conversationId: 'conv-abc',
  });

  assert.ok(existsSync(profile.mcpConfigPath));
  assert.ok(existsSync(profile.agentFile));

  const mcpConfig = JSON.parse(readFileSync(profile.mcpConfigPath, 'utf8'));
  assert.equal(mcpConfig.mcpServers.minecraft_fast.serverUrl, 'http://127.0.0.1:25613/mcp/fast');
  assert.ok(Array.isArray(mcpConfig.mcpServers.files_fast.args));

  const agentContent = readFileSync(profile.agentFile, 'utf8');
  assert.match(agentContent, /name: xiaoke-fast/);
  assert.match(agentContent, /commandExecutionPolicy: off/);
  assert.match(agentContent, /# 测试提示词/);

  assert.ok(profile.args.includes('--conversation'));
  assert.ok(profile.args.includes('conv-abc'));
  assert.ok(profile.args.includes('gemini-3.8-flash'));
});
