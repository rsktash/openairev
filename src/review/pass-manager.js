import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const PASS_FILES = [
  { file: 'pass_1_surface.md', focus: 'surface' },
  { file: 'pass_2_edge_cases.md', focus: 'edge_cases' },
  { file: 'pass_3_requirements.md', focus: 'requirements' },
  { file: 'pass_4_reconsider.md', focus: 'reconsider' },
  { file: 'pass_5_verdict.md', focus: 'verdict' },
];

/**
 * Load pass templates up to the given depth.
 * Looks in .airev/prompts/review_passes/ first (user overrides),
 * then falls back to built-in prompts/.
 */
export function loadPasses(depth, cwd = process.cwd()) {
  const count = Math.min(Math.max(depth, 1), 5);
  const passes = [];

  // Always include passes up to depth, but always include verdict (last pass)
  const indices = [];
  if (count === 1) {
    // Single pass: just the verdict
    indices.push(4);
  } else if (count === 2) {
    indices.push(0, 4);
  } else if (count === 3) {
    indices.push(0, 1, 4);
  } else if (count === 4) {
    indices.push(0, 1, 2, 4);
  } else {
    indices.push(0, 1, 2, 3, 4);
  }

  for (const idx of indices) {
    const { file, focus } = PASS_FILES[idx];
    const prompt = loadPassFile(file, cwd);
    passes.push({ focus, prompt });
  }

  return passes;
}

function loadPassFile(filename, cwd) {
  // Try user-customized version first
  const userPath = join(cwd, '.airev', 'prompts', 'review_passes', filename);
  if (existsSync(userPath)) {
    return readFileSync(userPath, 'utf-8').trim();
  }

  // Fall back to built-in
  const builtinPath = join(cwd, 'prompts', 'review_passes', filename);
  if (existsSync(builtinPath)) {
    return readFileSync(builtinPath, 'utf-8').trim();
  }

  throw new Error(`Pass template not found: ${filename}`);
}
