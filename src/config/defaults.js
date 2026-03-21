export const DEFAULTS = {
  agents: {
    claude_code: {
      cmd: 'claude',
      available: false,
    },
    codex: {
      cmd: 'codex',
      available: false,
    },
  },
  // max_iterations is per direction — it controls how many rounds the
  // EXECUTOR gets to fix its code after receiving review feedback.
  // Claude Code is less stable at aligning to reviewer feedback across
  // rounds, so it gets more iterations to converge. Codex applies
  // feedback more consistently, so fewer iterations are needed.
  // These are defaults — users override during `openairev init`.
  review_policy: {
    claude_code: {
      reviewer: 'codex',
      max_iterations: 5,
    },
    codex: {
      reviewer: 'claude_code',
      max_iterations: 1,
    },
  },
  review_trigger: 'explicit',
  tools: {
    run_tests: 'npm test',
    run_lint: 'npm run lint',
    run_typecheck: 'npx tsc --noEmit',
  },
  session: {
    store_history: true,
    archive_after: '7d',
  },
};
