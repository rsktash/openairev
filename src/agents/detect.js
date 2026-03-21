import { execFileSync } from 'child_process';

export async function detectAgent(cmd) {
  try {
    execFileSync('which', [cmd], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}
