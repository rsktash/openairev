import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const INLINE_THRESHOLD = 8_000; // characters — inline if under this

// Rough estimate: ~4 characters per token for code/diffs
const CHARS_PER_TOKEN = 4;

// Reviewer context budgets (in tokens). Leave room for prompt, schema, and output.
// These are conservative — better to compact than to blow the budget.
const REVIEWER_BUDGETS = {
  codex: 100_000,       // Codex has ~200k context, reserve half for output + tools
  claude_code: 150_000, // Claude has ~200k context, needs less reserve
};

const DEFAULT_BUDGET = 100_000;

/**
 * Estimate token count from character length.
 */
export function estimateTokens(text) {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Get the token budget for a reviewer.
 */
export function getReviewerBudget(reviewerName) {
  return REVIEWER_BUDGETS[reviewerName] || DEFAULT_BUDGET;
}

/**
 * Compact a diff to fit within a token budget.
 * Strategy: parse into per-file hunks, sort by size ascending,
 * drop the largest files first until it fits.
 * Returns { content, compacted, stats }.
 */
export function compactDiff(diff, { maxTokens }) {
  const tokens = estimateTokens(diff);
  if (tokens <= maxTokens) {
    return { content: diff, compacted: false, partial: false, stats: { originalTokens: tokens, finalTokens: tokens, filesDropped: 0 } };
  }

  const files = parseDiffFiles(diff);
  // Sort by size descending — drop largest first
  files.sort((a, b) => b.content.length - a.content.length);

  // Reserve chars for the omission notice (worst case)
  const noticeOverhead = 500;
  const maxChars = (maxTokens * CHARS_PER_TOKEN) - noticeOverhead;
  let totalChars = diff.length;
  const dropped = [];

  while (totalChars > maxChars && files.length > 1) {
    const largest = files.shift();
    totalChars -= largest.content.length;
    dropped.push(largest.name);
  }

  // If single file still too large, truncate it
  if (files.length === 1 && totalChars > maxChars) {
    const file = files[0];
    const truncateAt = maxChars - 200;
    file.content = file.content.slice(0, Math.max(0, truncateAt)) + `\n\n... [TRUNCATED — file too large for reviewer context] ...\n`;
  }

  let compactedDiff = files.map(f => f.content).join('\n');
  if (dropped.length > 0) {
    const notice = `\n\n--- FILES OMITTED (too large for reviewer context) ---\n${dropped.map(f => `  ${f}`).join('\n')}\n--- This is a PARTIAL review. Only the files below were included. ---\n`;
    compactedDiff = notice + compactedDiff;
  }

  const finalTokens = estimateTokens(compactedDiff);

  return {
    content: compactedDiff,
    compacted: true,
    partial: dropped.length > 0,
    stats: {
      originalTokens: tokens,
      finalTokens,
      filesDropped: dropped.length,
      droppedFiles: dropped,
    },
  };
}

/**
 * Parse a unified diff into per-file sections.
 */
function parseDiffFiles(diff) {
  const files = [];
  // Split on diff headers (diff --git, or --- a/ lines preceded by blank)
  const parts = diff.split(/(?=^diff --git )/m);

  for (const part of parts) {
    if (!part.trim()) continue;
    const nameMatch = part.match(/^diff --git a\/(.+?) b\//m)
      || part.match(/^---\s+a\/(.+)/m)
      || part.match(/^\+\+\+\s+b\/(.+)/m);
    const name = nameMatch ? nameMatch[1] : 'unknown';
    files.push({ name, content: part });
  }

  return files;
}

/**
 * Stage review input. For small content, returns it inline.
 * For large content, writes to .openairev/tmp/ and returns a file reference.
 */
export function stageInput(content, { cwd = process.cwd(), label = 'review-input' } = {}) {
  if (content.length <= INLINE_THRESHOLD) {
    return { mode: 'inline', content };
  }

  const tmpDir = join(cwd, '.openairev', 'tmp');
  mkdirSync(tmpDir, { recursive: true });

  const filename = `${label}-${Date.now()}.diff`;
  const filePath = join(tmpDir, filename);
  const relativePath = `.openairev/tmp/${filename}`;

  writeFileSync(filePath, content);

  return { mode: 'file', filePath, relativePath };
}

/**
 * Build the prompt prefix for the first pass based on staging result.
 */
export function buildInputReference(staged) {
  if (staged.mode === 'inline') {
    return `\n\n--- DIFF ---\n${staged.content}`;
  }
  return `\n\nThe diff to review is stored at: ${staged.relativePath}\nRead that file to see the full changes. It is too large to include inline.`;
}
