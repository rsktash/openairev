import { readFileSync } from 'fs';
import { join } from 'path';
import { loadPasses } from './pass-manager.js';
import { createAdapter } from '../agents/registry.js';

/**
 * Execute a full review cycle using the configured reviewer agent.
 */
export async function runReview(diff, { config, reviewerName, depth, taskDescription, cwd = process.cwd() }) {
  const passes = loadPasses(depth, cwd);
  const adapter = createAdapter(reviewerName, config);

  // Load reviewer system prompt
  const reviewerPrompt = loadReviewerPrompt(cwd);

  // Prepend reviewer instructions to the first pass
  if (passes.length > 0) {
    passes[0].prompt = `${reviewerPrompt}\n\n${passes[0].prompt}`;
  }

  // Add task context if available
  if (taskDescription && passes.length > 0) {
    passes[0].prompt = `Task: ${taskDescription}\n\n${passes[0].prompt}`;
  }

  const sessionName = `review-${Date.now()}`;
  const passResults = await adapter.multiPassReview(diff, passes, { sessionName });

  // Extract final verdict from last pass
  const lastPass = passResults[passResults.length - 1];
  const verdict = extractVerdict(lastPass);

  return {
    reviewer: reviewerName,
    depth,
    passes: passResults.map(p => ({
      pass: p.pass,
      focus: p.focus,
    })),
    verdict,
    session_id: adapter.sessionName || adapter.sessionId,
  };
}

function loadReviewerPrompt(cwd) {
  const userPath = join(cwd, '.airev', 'prompts', 'reviewer.md');
  const builtinPath = join(cwd, 'prompts', 'reviewer.md');

  try {
    return readFileSync(userPath, 'utf-8').trim();
  } catch {
    try {
      return readFileSync(builtinPath, 'utf-8').trim();
    } catch {
      return 'You are an expert code reviewer. Review the provided diff thoroughly.';
    }
  }
}

function extractVerdict(lastPass) {
  const result = lastPass?.result;
  if (!result) return null;

  // Schema-enforced output from claude: look in structured_output or result
  if (result.structured_output) return result.structured_output;
  if (result.result && typeof result.result === 'object' && result.result.status) return result.result;

  // Direct verdict object
  if (result.status && ['approved', 'needs_changes', 'reject'].includes(result.status)) {
    return result;
  }

  // Try to extract from raw text
  const raw = result.result || result.raw || '';
  if (typeof raw === 'string') {
    const jsonMatch = raw.match(/\{[\s\S]*"status"\s*:\s*"(approved|needs_changes|reject)"[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch {
        // fall through
      }
    }
  }

  return null;
}
