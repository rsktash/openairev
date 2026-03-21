import { readFileSync } from 'fs';
import { join } from 'path';

const cache = new Map();

/**
 * Load a prompt file with caching. Checks .openairev/prompts/ first, then builtin prompts/.
 */
export function loadPromptFile(filename, cwd) {
  const key = `${cwd}:${filename}`;
  if (cache.has(key)) return cache.get(key);

  const userPath = join(cwd, '.openairev', 'prompts', filename);
  const builtinPath = join(cwd, 'prompts', filename);

  let content = '';
  try {
    content = readFileSync(userPath, 'utf-8').trim();
  } catch {
    try {
      content = readFileSync(builtinPath, 'utf-8').trim();
    } catch {
      // No prompt file found
    }
  }

  cache.set(key, content);
  return content;
}
