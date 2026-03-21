import { execFileSync, execSync } from 'child_process';
import { existsSync } from 'fs';

/**
 * Run configured tool gates and return results.
 */
export function runToolGates(tools, cwd = process.cwd()) {
  const results = {};

  for (const tool of tools) {
    switch (tool) {
      case 'run_tests':
        results.tests = runTests(cwd);
        break;
      case 'run_lint':
        results.lint = runLint(cwd);
        break;
      case 'run_typecheck':
        results.typecheck = runTypecheck(cwd);
        break;
    }
  }

  return results;
}

function runTests(cwd) {
  try {
    const cmd = detectTestCommand(cwd);
    const output = execSync(cmd, { cwd, encoding: 'utf-8', timeout: 120_000, stdio: 'pipe' });
    return { passed: true, output: output.slice(-500) };
  } catch (e) {
    return { passed: false, output: (e.stdout || e.message).slice(-500) };
  }
}

function runLint(cwd) {
  try {
    const output = execSync('npx eslint . --format compact 2>&1 || true', {
      cwd, encoding: 'utf-8', timeout: 60_000, shell: true, stdio: 'pipe',
    });
    const errors = (output.match(/\d+ error/)?.[0] || '0 errors');
    return { passed: !output.includes(' error'), output: errors };
  } catch (e) {
    return { passed: false, output: e.message.slice(-500) };
  }
}

function runTypecheck(cwd) {
  try {
    execSync('npx tsc --noEmit 2>&1', {
      cwd, encoding: 'utf-8', timeout: 60_000, shell: true, stdio: 'pipe',
    });
    return { passed: true, output: 'No type errors' };
  } catch (e) {
    return { passed: false, output: (e.stdout || e.message).slice(-500) };
  }
}

function detectTestCommand(cwd) {
  if (existsSync(`${cwd}/package.json`)) return 'npm test';
  if (existsSync(`${cwd}/pytest.ini`) || existsSync(`${cwd}/pyproject.toml`)) return 'pytest';
  if (existsSync(`${cwd}/Makefile`)) return 'make test';
  return 'npm test';
}
