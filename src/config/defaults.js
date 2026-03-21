export const DEFAULTS = {
  agents: {
    claude_code: {
      cmd: 'claude',
      available: false,
      review_depth: 1,
    },
    codex: {
      cmd: 'codex',
      available: false,
      review_depth: 5,
    },
  },
  review_policy: {
    claude_code: 'codex',
    codex: 'claude_code',
  },
  review_trigger: 'explicit',
  tools: ['run_tests', 'run_lint', 'run_typecheck', 'get_diff'],
  session: {
    max_rounds: 3,
    store_history: true,
    archive_after: '7d',
  },
};
