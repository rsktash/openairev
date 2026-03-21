#!/usr/bin/env node

import { Command } from 'commander';
import { initCommand } from '../src/cli/init.js';
import { reviewCommand } from '../src/cli/review.js';
import { statusCommand } from '../src/cli/status.js';
import { historyCommand } from '../src/cli/history.js';

const program = new Command();

program
  .name('airev')
  .description('Cross-model AI code reviewer')
  .version('0.1.0');

program
  .command('init')
  .description('Interactive setup wizard')
  .action(initCommand);

program
  .command('review')
  .description('Trigger a review on current changes')
  .option('-d, --depth <number>', 'Override review depth', parseInt)
  .option('-e, --executor <agent>', 'Who wrote the code (claude_code|codex)')
  .option('-r, --reviewer <agent>', 'Who reviews (claude_code|codex)')
  .option('--diff <ref>', 'Git diff ref (default: staged or HEAD)')
  .option('--file <path>', 'Review a specific file instead of diff')
  .option('--dry-run', 'Show what would be sent without calling reviewer')
  .action(reviewCommand);

program
  .command('status')
  .description('Show current session state')
  .action(statusCommand);

program
  .command('history')
  .description('List past review sessions')
  .option('-n, --limit <number>', 'Number of sessions to show', parseInt, 10)
  .action(historyCommand);

program.parse();
