import { execFileSync } from 'child_process';

/**
 * Get the current git diff. Tries staged first, then unstaged, then HEAD.
 */
export function getDiff(ref) {
  if (ref) {
    return gitExec(['diff', ref]);
  }

  // Try staged changes first
  const staged = gitExec(['diff', '--cached']);
  if (staged.trim()) return staged;

  // Then unstaged
  const unstaged = gitExec(['diff']);
  if (unstaged.trim()) return unstaged;

  // Fall back to last commit
  return gitExec(['diff', 'HEAD~1']);
}

/**
 * Get list of changed files.
 */
export function getChangedFiles(ref) {
  if (ref) {
    return gitExec(['diff', '--name-only', ref]).trim().split('\n').filter(Boolean);
  }

  const staged = gitExec(['diff', '--cached', '--name-only']).trim();
  if (staged) return staged.split('\n').filter(Boolean);

  const unstaged = gitExec(['diff', '--name-only']).trim();
  if (unstaged) return unstaged.split('\n').filter(Boolean);

  return gitExec(['diff', '--name-only', 'HEAD~1']).trim().split('\n').filter(Boolean);
}

/**
 * Read a file's contents.
 */
export function readFile(filePath) {
  return execFileSync('cat', [filePath], { encoding: 'utf-8' });
}

function gitExec(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf-8', maxBuffer: 5 * 1024 * 1024 });
  } catch (e) {
    throw new Error(`git ${args[0]} failed: ${e.message}`);
  }
}
