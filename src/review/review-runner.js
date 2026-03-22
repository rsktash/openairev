import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createAdapter } from '../agents/registry.js';
import { stageInput, buildInputReference, compactDiff, getReviewerBudget, estimateTokens } from './input-stager.js';
import { loadPromptFile } from './prompt-loader.js';

export async function runReview(content, {
  config,
  reviewerName,
  promptFile = 'reviewer.md',
  taskDescription,
  specRef,
  cwd = process.cwd(),
  sessionId = null,
  stream = false,
  signal,
}) {
  const adapter = createAdapter(reviewerName, config, { cwd });

  if (sessionId) {
    adapter.restoreSession(sessionId);
  }

  const reviewerPrompt = loadPromptFile(promptFile, cwd);

  // Compact diff if it exceeds the reviewer's context budget
  const budget = getReviewerBudget(reviewerName);
  const { content: compactedContent, compacted, stats } = compactDiff(content, { maxTokens: budget });

  const staged = stageInput(compactedContent, { cwd });
  const inputRef = buildInputReference(staged);

  let prompt = reviewerPrompt;
  if (taskDescription) {
    prompt = `Task: ${taskDescription}\n\n${prompt}`;
  }
  if (specRef) {
    prompt += `\n\nSpec reference: ${specRef}\nRead the spec file for requirements and acceptance criteria.`;
  }
  prompt = `${prompt}${inputRef}`;

  const schemaFile = promptFile === 'plan-reviewer.md' ? 'plan-verdict-schema.json' : 'verdict-schema.json';

  const result = await adapter.run(prompt, {
    useSchema: true,
    schemaFile,
    continueSession: !!sessionId,
    sessionName: sessionId ? undefined : `review-${Date.now()}`,
    stream: stream ? { reviewerName, tty: stream === true, onProgress: stream.onProgress } : false,
    signal,
  });

  const verdict = extractVerdict(result);
  const executorFeedback = buildExecutorFeedback(verdict, cwd);
  const rawOutput = result?.raw_output || result?.raw || '';

  logReviewerOutput(rawOutput, reviewerName, cwd);

  const reviewResult = {
    reviewer: reviewerName,
    verdict,
    executor_feedback: executorFeedback,
    reviewer_output: rawOutput,
    progress: result?.progress || [],
    session_id: adapter.sessionName || adapter.sessionId,
  };

  if (compacted) {
    reviewResult.context_stats = stats;
  }

  // Mark partial reviews so callers know files were omitted
  if (compacted && stats.filesDropped > 0 && verdict) {
    reviewResult.partial = true;
    reviewResult.partial_notice = `PARTIAL REVIEW: ${stats.filesDropped} files were omitted to fit the reviewer's context budget (${stats.droppedFiles.join(', ')}). Re-run with a smaller diff to cover them.`;
  }

  // Diagnose null verdicts — check for explicit errors before blaming context budget
  if (!verdict) {
    const explicitError = result?.error;
    if (explicitError) {
      reviewResult.error = `Reviewer (${reviewerName}) failed: ${explicitError}`;
    } else {
      reviewResult.error = `Reviewer (${reviewerName}) produced no verdict. ` +
        `Diff was ~${stats.originalTokens} tokens` +
        (compacted ? `, compacted to ~${stats.finalTokens} tokens (${stats.filesDropped} files dropped)` : '') +
        `. Possible causes: context budget exceeded, auth failure, or schema mismatch. Check .openairev/logs/ for details.`;
    }
  }

  return reviewResult;
}

function logReviewerOutput(rawOutput, reviewerName, cwd) {
  if (!rawOutput) return;
  try {
    const logDir = join(cwd, '.openairev', 'logs');
    mkdirSync(logDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    writeFileSync(join(logDir, `review-${reviewerName}-${ts}.log`), rawOutput);
  } catch {
    // non-critical, don't fail the review
  }
}

function buildExecutorFeedback(verdict, cwd) {
  const feedbackPrompt = loadPromptFile('executor-feedback.md', cwd);
  if (!verdict) return null;
  return `${feedbackPrompt}\n\`\`\`json\n${JSON.stringify(verdict, null, 2)}\n\`\`\``;
}

function extractVerdict(result) {
  if (!result) return null;

  if (result.structured_output) return result.structured_output;
  if (result.result && typeof result.result === 'object' && result.result.status) return result.result;

  if (result.status && ['approved', 'needs_changes', 'reject'].includes(result.status)) {
    return result;
  }

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
