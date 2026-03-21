import chalk from 'chalk';
import { configExists } from '../config/config-loader.js';

export const STAGE_LABELS = {
  analyze: 'Analyzing',
  awaiting_user: 'Waiting for User',
  planning: 'Planning',
  plan_review: 'Plan Review',
  plan_fix: 'Fixing Plan',
  implementation: 'Implementing',
  code_review: 'Code Review',
  code_fix: 'Fixing Code',
  done: 'Done',
};

export function stageLabel(stage) {
  return STAGE_LABELS[stage] || stage;
}

const STATUS_COLORS = {
  approved: chalk.green,
  completed: chalk.green,
  active: chalk.blue,
  blocked: chalk.yellow,
  needs_changes: chalk.yellow,
  in_progress: chalk.yellow,
  max_rounds_reached: chalk.yellow,
  reject: chalk.red,
  rejected: chalk.red,
  error: chalk.red,
};

export function statusColor(status) {
  return STATUS_COLORS[status] || chalk.white;
}

export function timeAgo(date) {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function requireConfig(cwd) {
  if (!configExists(cwd)) {
    console.log(chalk.red('No .openairev/config.yaml found. Run `openairev init` first.'));
    process.exit(1);
  }
}
