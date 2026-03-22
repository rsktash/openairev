#!/usr/bin/env node

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
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
const PROGRESS_FILE = join(cwd, '.openairev', 'progress.json');

let activeReview = null;
let activeAbort = null;

const server = new McpServer({
  name: 'openairev',
  version: VERSION,
});

server.tool(
  'openairev_review',
  'TRIGGER: Use this tool when the user says "review", "review my code", "get a review", "check my changes", "openairev", or asks for independent/cross-model code review. Sends current code changes to a DIFFERENT AI model for independent review. The review starts in the background and returns immediately. After calling this, run `openairev wait` via Bash to stream progress and get the verdict — one blocking call, no polling needed.',
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

    mkdirSync(join(cwd, '.openairev'), { recursive: true });
    writeProgress({ status: 'running', reviewer: reviewerName, started: new Date().toISOString(), progress: [], verdict: null });

    const onProgress = (lines) => {
      writeProgress({ status: 'running', reviewer: reviewerName, started: new Date().toISOString(), progress: lines, verdict: null });
    };

    activeAbort = new AbortController();
    activeReview = runReview(diffContent, {
      config,
      reviewerName,
      taskDescription: task_description,
      cwd,
      stream: { onProgress },
      signal: activeAbort.signal,
    }).then((review) => {
      const session = createSession({ executor: execAgent, reviewer: reviewerName });
      session.iterations.push({ round: 1, review, timestamp: new Date().toISOString() });
      session.final_verdict = review.verdict;
      session.status = 'completed';
      saveSession(session, cwd);

      writeProgress({
        status: 'completed',
        reviewer: reviewerName,
        progress: review.progress || [],
        verdict: review.verdict,
        executor_feedback: review.executor_feedback,
      });
      activeReview = null;
      activeAbort = null;
      return review;
    }).catch((err) => {
      const status = activeAbort?.signal?.aborted ? 'cancelled' : 'error';
      writeProgress({ status, reviewer: reviewerName, error: err.message, progress: [], verdict: null });
      activeReview = null;
      activeAbort = null;
    });

    return {
      content: [{
        type: 'text',
        text: `Review started. Reviewer: ${reviewerName}\nProgress file: ${PROGRESS_FILE}\n\nRun \`openairev wait --file ${PROGRESS_FILE}\` via Bash to stream progress and get the verdict. The file may take a few seconds to appear — wait will handle this automatically. Do NOT re-call openairev_review or use sleep/polling.`,
      }],
    };
  }
);

server.tool(
  'openairev_status',
  'Check the progress and result of the current or most recent OpenAIRev review. Prefer running `openairev wait` via Bash instead — it streams progress and blocks until done.',
  {},
  async () => {
    const progress = readProgress();
    if (!progress) {
      return { content: [{ type: 'text', text: 'No review in progress. Call openairev_review first.' }] };
    }

    if (progress.status === 'running') {
      const lines = progress.progress || [];
      const text = lines.length > 0
        ? `Review in progress (reviewer: ${progress.reviewer}):\n${lines.map(l => `  ${l}`).join('\n')}\n\nStill running. Run \`openairev wait\` via Bash to stream progress until done.`
        : `Review in progress (reviewer: ${progress.reviewer}). Started: ${progress.started}\n\nRun \`openairev wait\` via Bash to stream progress until done.`;
      return { content: [{ type: 'text', text }] };
    }

    if (progress.status === 'error') {
      return { content: [{ type: 'text', text: `Review failed: ${progress.error}` }] };
    }

    const parts = [];
    if (progress.progress?.length > 0) {
      parts.push({ type: 'text', text: `Review complete:\n${progress.progress.map(l => `  ${l}`).join('\n')}` });
    }
    const feedback = progress.executor_feedback || JSON.stringify(progress.verdict || {}, null, 2);
    parts.push({ type: 'text', text: feedback });
    return { content: parts };
  }
);

server.tool(
  'openairev_cancel',
  'Cancel the currently running review. Use this when the review is taking too long, the diff was too large, or you want to retry with different parameters.',
  {},
  async () => {
    if (!activeReview || !activeAbort) {
      return { content: [{ type: 'text', text: 'No review is currently running.' }] };
    }
    activeAbort.abort();
    return { content: [{ type: 'text', text: 'Review cancelled.' }] };
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

function writeProgress(data) {
  try {
    data.cwd = cwd;
    data.progress_file = PROGRESS_FILE;
    writeFileSync(PROGRESS_FILE, JSON.stringify(data, null, 2));
  } catch { /* non-critical */ }
}

function readProgress() {
  try {
    if (!existsSync(PROGRESS_FILE)) return null;
    return JSON.parse(readFileSync(PROGRESS_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

const transport = new StdioServerTransport();
await server.connect(transport);
