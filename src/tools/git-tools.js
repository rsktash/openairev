import { execFileSync } from 'child_process';

/**
 * Get the current git diff. Tries staged first, then unstaged.
 * Returns empty string if no changes found.
 */
export function getDiff(ref) {
  if (ref) {
    return gitExec(['diff', ref]);
  }

  const staged = gitExec(['diff', '--cached']);
  if (staged.trim()) return staged;

  const unstaged = gitExec(['diff']);
  if (unstaged.trim()) return unstaged;

  return '';
}

function gitExec(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf-8', maxBuffer: 5 * 1024 * 1024 });
  } catch (e) {
    throw new Error(`git ${args[0]} failed: ${e.message}`);
  }
}
