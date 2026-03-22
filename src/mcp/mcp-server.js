#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { loadConfig, getReviewer } from '../config/config-loader.js';
import { getDiff } from '../tools/git-tools.js';
import { runToolGates } from '../tools/tool-runner.js';
import { runReview } from '../review/review-runner.js';
import { createSession, saveSession } from '../session/session-manager.js';
import { VERSION } from '../version.js';

const cwd = process.cwd();
const config = loadConfig(cwd);

const server = new McpServer({
  name: 'openairev',
  version: VERSION,
});

server.tool(
  'openairev_review',
  'TRIGGER: Use this tool when the user says "review", "review my code", "get a review", "check my changes", "openairev", or asks for independent/cross-model code review. Sends current code changes to a DIFFERENT AI model for independent review. Returns a structured verdict with critical issues, test gaps, risk level, confidence score, and repair instructions.',
  {
    executor: z.string().optional().describe('Which agent wrote the code (claude_code or codex). If you are Claude Code, set this to "claude_code". If you are Codex, set this to "codex".'),
    diff: z.string().optional().describe('The diff to review. IMPORTANT: Pass only the diff for files YOU changed, not the entire repo. Use `git diff HEAD -- file1 file2` to scope it. If omitted, auto-detects from git which may be too large.'),
    diff_cmd: z.string().optional().describe('The git command used to get the diff, e.g. "git diff HEAD -- src/auth.ts src/routes.ts". If provided instead of diff, the server will run this command to get the diff.'),
    task_description: z.string().optional().describe('What the code is supposed to do. Used for requirement checking.'),
  },
  async ({ executor, diff, diff_cmd, task_description }) => {
    const execAgent = executor || Object.keys(config.agents || {}).find(a => config.agents[a].available);
    const reviewerName = getReviewer(config, execAgent);
    if (!reviewerName) {
      return { content: [{ type: 'text', text: `No reviewer configured for executor "${execAgent}"` }] };
    }

    let diffContent = diff;
    if (!diffContent && diff_cmd) {
      try {
        const { execSync } = await import('child_process');
        diffContent = execSync(diff_cmd, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024, cwd });
      } catch (e) {
        return { content: [{ type: 'text', text: `diff_cmd failed: ${e.message}` }] };
      }
    }
    if (!diffContent) diffContent = getDiff();
    if (!diffContent?.trim()) {
      return { content: [{ type: 'text', text: 'No changes found to review.' }] };
    }

    const review = await runReview(diffContent, {
      config,
      reviewerName,
      taskDescription: task_description,
      cwd,
      stream: 'silent',
    });

    const session = createSession({ executor: execAgent, reviewer: reviewerName });
    session.iterations.push({ round: 1, review, timestamp: new Date().toISOString() });
    session.final_verdict = review.verdict;
    session.status = 'completed';
    saveSession(session, cwd);

    const parts = [];

    if (review.progress?.length > 0) {
      parts.push({ type: 'text', text: `Review progress:\n${review.progress.map(l => `  ${l}`).join('\n')}` });
    }

    const feedback = review.executor_feedback || JSON.stringify(review.verdict || review, null, 2);
    parts.push({ type: 'text', text: feedback });

    return { content: parts };
  }
);

server.tool(
  'openairev_status',
  'Get the status and verdict of the most recent OpenAIRev review session.',
  {},
  async () => {
    const { listSessions } = await import('../session/session-manager.js');
    const sessions = listSessions(cwd, 1);
    if (sessions.length === 0) {
      return { content: [{ type: 'text', text: 'No review sessions found.' }] };
    }
    const last = sessions[0];
    const text = JSON.stringify({ id: last.id, status: last.status, verdict: last.final_verdict, created: last.created }, null, 2);
    return { content: [{ type: 'text', text }] };
  }
);

server.tool(
  'openairev_run_tests',
  'Run the project test suite and return pass/fail results.',
  {},
  async () => {
    const testCmd = config.tools?.run_tests || 'npm test';
    const results = runToolGates(['run_tests'], cwd, { run_tests: testCmd });
    return { content: [{ type: 'text', text: JSON.stringify(results.tests, null, 2) }] };
  }
);

server.tool(
  'openairev_run_lint',
  'Run the project linter and return results.',
  {},
  async () => {
    const lintCmd = config.tools?.run_lint || 'npm run lint';
    const results = runToolGates(['run_lint'], cwd, { run_lint: lintCmd });
    return { content: [{ type: 'text', text: JSON.stringify(results.lint, null, 2) }] };
  }
);

server.tool(
  'openairev_get_diff',
  'Get the current git diff (staged, unstaged, or last commit).',
  {
    ref: z.string().optional().describe('Git ref to diff against'),
  },
  async ({ ref }) => {
    const diffContent = getDiff(ref);
    return { content: [{ type: 'text', text: diffContent || 'No changes found.' }] };
  }
);

// Start server
const transport = new StdioServerTransport();
await server.connect(transport);
