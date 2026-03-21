import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import YAML from 'yaml';
import { DEFAULTS } from './defaults.js';

const CONFIG_DIR = '.airev';
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
    return { ...DEFAULTS };
  }
  const raw = readFileSync(configPath, 'utf-8');
  const parsed = YAML.parse(raw);
  return { ...DEFAULTS, ...parsed };
}

export function getReviewer(config, executor) {
  return config.review_policy?.[executor] || null;
}

export function getReviewDepth(config, agentName) {
  return config.agents?.[agentName]?.review_depth ?? 1;
}
