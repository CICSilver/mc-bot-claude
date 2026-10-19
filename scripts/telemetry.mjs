// Model limits describe input capacity, not Agy's compaction trigger.
// https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash
// https://ai.google.dev/gemini-api/docs/thinking
const MODEL_WINDOWS = {
  'gemini-3.8-flash': { tokens: 1048576, kind: 'input' },
  'gemini-4-argon': { tokens: 1048576, kind: 'shared' },
};

const count = value => Number.isFinite(value) && value >= 0 ? value : null;

export function stepIdentity(entry) {
  return entry.conversationId && Number.isInteger(entry.stepIndex)
    ? `${entry.conversationId}:${entry.stepIndex}` : null;
}

export function makeStepUsage(step, { conversationId, turnId, model }) {
  const usage = step.usage ?? null;
  const fresh = count(usage?.input_tokens);
  const cached = count(usage?.cache_read_tokens);
  const input = fresh !== null && cached !== null ? fresh + cached : null;
  const name = String(model ?? '').replace(/-(low|medium|high|xhigh|max)$/i, '');
  const window = MODEL_WINDOWS[name];
  return {
    type: 'step_usage', conversationId, turnId, model,
    stepIndex: step.step_index ?? null,
    stepType: step.step_type,
    state: step.state,
    durationSeconds: count(step.duration_seconds),
    usage,
    contextInputTokens: input,
    contextLimitTokens: window?.tokens ?? null,
    contextLimitKind: window?.kind ?? null,
    contextLimitSource: window ? 'model_spec' : null,
    inputOccupancyPercent: input !== null && window ? input / window.tokens * 100 : null,
  };
}

export function summarizeContext(entries) {
  const steps = new Map(), checkpoints = new Map();
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    const id = stepIdentity(entry) ?? `record:${index}`;
    if (entry.type === 'step_usage') steps.set(id, { ...entry, index });
    if (entry.type === 'checkpoint') checkpoints.set(id, { ...entry, index });
  }
  const modelSteps = [...steps.values()].filter(e => e.stepType === 'agent_response');
  const measured = modelSteps.filter(e => count(e.contextInputTokens) !== null).toSorted((a, b) => a.index - b.index);
  const sorted = measured.toSorted((a, b) => a.contextInputTokens - b.contextInputTokens);
  const checkpointList = [...checkpoints.values()];
  const completed = checkpointList.filter(e => e.state === 'DONE');
  const transitions = completed.map(checkpoint => {
    const sameSession = measured.filter(e => e.conversationId === checkpoint.conversationId);
    const before = sameSession.findLast(e => e.index < checkpoint.index);
    const after = sameSession.find(e => e.index > checkpoint.index);
    return {
      conversationId: checkpoint.conversationId,
      stepIndex: checkpoint.stepIndex,
      at: checkpoint.at,
      beforeInputTokens: before?.contextInputTokens ?? null,
      afterInputTokens: after?.contextInputTokens ?? null,
    };
  });
  const resets = entries.filter(e => e.type === 'conversation_reset_requested');
  const restarts = entries.filter(e => e.type === 'agy_process_started' && e.reason !== 'initial');
  return {
    available: entries.some(e => ['agy_init', 'agy_process_started', 'step_usage', 'checkpoint', 'agy_event', 'agy_step'].includes(e.type)),
    modelSteps: modelSteps.length,
    measuredSteps: measured.length,
    missingUsageSteps: modelSteps.length - measured.length,
    peak: sorted.at(-1) ?? null,
    p95InputTokens: sorted.length ? sorted[Math.ceil(sorted.length * 0.95) - 1].contextInputTokens : null,
    checkpoints: completed.length,
    unfinishedCheckpoints: checkpointList.length - completed.length,
    checkpointTransitions: transitions,
    resets,
    restarts,
    nativeEvents: entries.filter(e => e.type === 'agy_event' || e.type === 'agy_step'),
  };
}

const USAGE_KEYS = ['inputTokens', 'cachedInputTokens', 'outputTokens', 'reasoningOutputTokens', 'totalTokens'];

// Legacy logs identify usage by the preceding session/session_ready record.
// Cumulative results and per-step samples are separate accounting sources.
export function summarizeSessionUsage(entries) {
  const sessions = new Map();
  let conversationId = 'unknown:0', anonymous = 0;
  for (const entry of entries) {
    if (entry.type === 'session') conversationId = entry.threadId ?? `unknown:${++anonymous}`;
    if (entry.type === 'session_ready' && entry.threadId) conversationId = entry.threadId;
    if (entry.type === 'session_changed' && entry.conversationId) conversationId = entry.conversationId;
    if (entry.type !== 'usage' || !entry.tokenUsage?.total) continue;
    const id = entry.conversationId ?? conversationId;
    sessions.set(id, entry.tokenUsage.total);
  }
  if (!sessions.size) return null;
  const total = Object.fromEntries(USAGE_KEYS.map(key => [key,
    [...sessions.values()].every(u => count(u[key]) !== null)
      ? [...sessions.values()].reduce((sum, u) => sum + u[key], 0) : null,
  ]));
  return { sessions: sessions.size, total };
}
