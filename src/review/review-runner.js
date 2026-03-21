import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createAdapter } from '../agents/registry.js';
import { stageInput, buildInputReference } from './input-stager.js';
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
}) {
  const adapter = createAdapter(reviewerName, config, { cwd });

  if (sessionId) {
    adapter.restoreSession(sessionId);
  }

  const reviewerPrompt = loadPromptFile(promptFile, cwd);
  const staged = stageInput(content, { cwd });
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
    stream: stream ? reviewerName : false,
  });

  const verdict = extractVerdict(result);
  const executorFeedback = buildExecutorFeedback(verdict, cwd);
  const rawOutput = result?.raw_output || result?.raw || '';

  logReviewerOutput(rawOutput, reviewerName, cwd);

  return {
    reviewer: reviewerName,
    verdict,
    executor_feedback: executorFeedback,
    reviewer_output: rawOutput,
    session_id: adapter.sessionName || adapter.sessionId,
  };
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
