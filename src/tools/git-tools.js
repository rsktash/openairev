import { execFileSync } from 'child_process';

// Files to exclude from diffs — lock files, generated code, etc.
const EXCLUDE_PATTERNS = [
  '*.lock',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  '*.generated.*',
  'dist/*',
  'build/*',
  '.next/*',
];

/**
 * Get the current git diff. Tries staged first, then unstaged.
 * Returns empty string if no changes found.
 * Uses minimal context (1 line) and excludes irrelevant files.
 */
export function getDiff(ref, { context = 1, excludes = EXCLUDE_PATTERNS } = {}) {
  const excludeArgs = excludes.flatMap(p => ['--', `:!${p}`]);
  const contextArgs = [`-U${context}`];

  if (ref) {
    return gitExec(['diff', ...contextArgs, ref, ...excludeArgs]);
  }

  const staged = gitExec(['diff', '--cached', ...contextArgs, ...excludeArgs]);
  if (staged.trim()) return staged;

  const unstaged = gitExec(['diff', ...contextArgs, ...excludeArgs]);
  if (unstaged.trim()) return unstaged;

  return '';
}

function gitExec(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
  } catch (e) {
    throw new Error(`git ${args[0]} failed: ${e.message}`);
  }
}
