import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import YAML from 'yaml';
import { DEFAULTS } from './defaults.js';

const CONFIG_DIR = '.openairev';
const CONFIG_FILE = 'config.yaml';

export function getConfigDir(cwd = process.cwd()) {
  return join(cwd, CONFIG_DIR);
}

export function getConfigPath(cwd = process.cwd()) {
  return join(getConfigDir(cwd), CONFIG_FILE);
}

export function configExists(cwd = process.cwd()) {
  return existsSync(getConfigPath(cwd));
}

export function loadConfig(cwd = process.cwd()) {
  const configPath = getConfigPath(cwd);
  if (!existsSync(configPath)) {
    return deepMerge({}, DEFAULTS);
  }
  const raw = readFileSync(configPath, 'utf-8');
  const parsed = YAML.parse(raw);
  return deepMerge(DEFAULTS, parsed);
}

/**
 * Get the reviewer agent name for a given executor.
 * Supports both formats:
 *   review_policy.claude_code: "codex"              (simple)
 *   review_policy.claude_code: { reviewer: "codex" } (full)
 */
export function getReviewer(config, executor) {
  const policy = config.review_policy?.[executor];
  if (!policy) return null;
  if (typeof policy === 'string') return policy;
  return policy.reviewer || null;
}

/**
 * Get max iterations for a given executor↔reviewer direction.
 */
export function getMaxIterations(config, executor) {
  const policy = config.review_policy?.[executor];
  if (typeof policy === 'object' && policy.max_iterations != null) {
    return policy.max_iterations;
  }
  return 3; // default
}

/**
 * Deep merge two objects. User values override defaults.
 * Arrays are replaced, not merged.
 */
function deepMerge(defaults, overrides) {
  if (!overrides) return { ...defaults };
  if (!defaults) return { ...overrides };

  const result = { ...defaults };
  for (const key of Object.keys(overrides)) {
    const val = overrides[key];
    if (val && typeof val === 'object' && !Array.isArray(val) &&
        result[key] && typeof result[key] === 'object' && !Array.isArray(result[key])) {
      result[key] = deepMerge(result[key], val);
    } else {
      result[key] = val;
    }
  }
  return result;
}
