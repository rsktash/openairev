#!/usr/bin/env node

import { Command } from 'commander';
import { initCommand } from '../src/cli/init.js';
import { reviewCommand } from '../src/cli/review.js';
import { resumeCommand } from '../src/cli/resume.js';
import { statusCommand } from '../src/cli/status.js';
import { historyCommand } from '../src/cli/history.js';

const program = new Command();

program
  .name('openairev')
  .description('OpenAIRev — cross-model AI code reviewer')
  .version('0.2.2');

program
  .command('init')
  .description('Interactive setup wizard')
  .action(initCommand);

program
  .command('review')
  .description('Start a review workflow or single review')
  .option('-e, --executor <agent>', 'Who wrote the code (claude_code|codex)')
  .option('-r, --reviewer <agent>', 'Who reviews (claude_code|codex)')
  .option('--diff <ref>', 'Git diff ref (default: staged or HEAD)')
  .option('--file <path>', 'Review a specific file instead of diff')
  .option('--task <description>', 'Task description for requirement checking')
  .option('--spec-ref <path>', 'Path to OpenSpec change directory')
  .option('--rounds <number>', 'Max review-fix rounds', parseInt)
  .option('--plan', 'Full workflow: analyze → plan → review → implement')
  .option('--quick', 'Skip analyze, go straight to implement → review')
  .option('--once', 'Single review only, no workflow')
  .option('--dry-run', 'Show what would happen without executing')
  .action(reviewCommand);

program
  .command('resume')
  .description('Resume an active or blocked workflow')
  .option('--chain <id>', 'Resume a specific chain by ID')
  .action(resumeCommand);

program
  .command('status')
  .description('Show current workflow state')
  .action(statusCommand);

program
  .command('history')
  .description('List past workflows and sessions')
  .option('-n, --limit <number>', 'Number of items to show', parseInt, 10)
  .option('--chains', 'Show chains instead of sessions')
  .action(historyCommand);

program.parse();
