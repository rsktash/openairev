import { ClaudeCodeAdapter } from './claude-code.js';
import { CodexAdapter } from './codex.js';

const ADAPTERS = {
  claude_code: ClaudeCodeAdapter,
  codex: CodexAdapter,
};

export function createAdapter(agentName, config, { cwd } = {}) {
  const AdapterClass = ADAPTERS[agentName];
  if (!AdapterClass) {
    throw new Error(`Unknown agent: ${agentName}. Available: ${Object.keys(ADAPTERS).join(', ')}`);
  }
  const agentConfig = config.agents?.[agentName] || {};
  return new AdapterClass({ cmd: agentConfig.cmd, cwd });
}

export function listAgents() {
  return Object.keys(ADAPTERS);
}
