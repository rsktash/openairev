import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const INLINE_THRESHOLD = 8_000; // characters — inline if under this

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
