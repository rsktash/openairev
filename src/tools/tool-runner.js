import { execSync } from 'child_process';

/**
 * Run configured tool gates and return results.
 * Uses explicit commands from config, or falls back to defaults.
 */
export function runToolGates(tools, cwd = process.cwd(), toolCommands = {}) {
  const results = {};

  for (const tool of tools) {
    const cmd = toolCommands[tool];
    switch (tool) {
      case 'run_tests':
        results.tests = runCommand(cmd || 'npm test', cwd);
        break;
      case 'run_lint':
        results.lint = runCommand(cmd || 'npm run lint', cwd);
        break;
      case 'run_typecheck':
        results.typecheck = runCommand(cmd || 'npx tsc --noEmit', cwd);
        break;
      default:
        if (cmd) {
          results[tool] = runCommand(cmd, cwd);
        }
        break;
    }
  }

  return results;
}

function runCommand(cmd, cwd) {
  try {
    const output = execSync(cmd, {
      cwd,
      encoding: 'utf-8',
      timeout: 120_000,
      stdio: 'pipe',
      shell: true,
    });
    return { passed: true, output: output.trim().slice(-500) || 'OK' };
  } catch (e) {
    const output = (e.stdout || '') + (e.stderr || '') || e.message;
    return { passed: false, output: output.trim().slice(-500) };
  }
}
