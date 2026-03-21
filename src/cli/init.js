import { writeFileSync, mkdirSync, copyFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import inquirer from 'inquirer';
import YAML from 'yaml';
import chalk from 'chalk';
import { getConfigDir, getConfigPath, configExists } from '../config/config-loader.js';
import { detectAgent } from '../agents/detect.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_SRC = join(__dirname, '../../prompts');

export async function initCommand() {
  const cwd = process.cwd();

  if (configExists(cwd)) {
    const { overwrite } = await inquirer.prompt([{
      type: 'confirm',
      name: 'overwrite',
      message: '.openairev/config.yaml already exists. Overwrite?',
      default: false,
    }]);
    if (!overwrite) {
      console.log(chalk.yellow('Init cancelled.'));
      return;
    }
  }

  console.log(chalk.bold('\nOpenAIRev Setup\n'));

  // Detect available CLIs
  const [claudeAvailable, codexAvailable] = await Promise.all([
    detectAgent('claude'),
    detectAgent('codex'),
  ]);

  console.log(`  Claude Code CLI: ${claudeAvailable ? chalk.green('found') : chalk.red('not found')}`);
  console.log(`  Codex CLI:       ${codexAvailable ? chalk.green('found') : chalk.red('not found')}\n`);

  if (!claudeAvailable && !codexAvailable) {
    console.log(chalk.red('No agent CLIs found. Install claude or codex CLI first.'));
    process.exit(1);
  }

  const agents = [];
  if (claudeAvailable) agents.push({ name: 'Claude Code', value: 'claude_code' });
  if (codexAvailable) agents.push({ name: 'Codex CLI', value: 'codex' });

  const answers = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'agents',
      message: 'Which agent CLIs do you want to use?',
      choices: agents,
      default: agents.map(a => a.value),
      validate: v => v.length > 0 || 'Select at least one agent',
    },
    {
      type: 'list',
      name: 'claude_reviewer',
      message: 'When Claude Code executes, who reviews?',
      choices: [
        { name: 'Codex (recommended)', value: 'codex' },
        { name: 'Claude Code (self-review)', value: 'claude_code' },
        { name: 'Skip review', value: null },
      ],
      when: a => a.agents.includes('claude_code'),
    },
    {
      type: 'list',
      name: 'codex_reviewer',
      message: 'When Codex executes, who reviews?',
      choices: [
        { name: 'Claude Code (recommended)', value: 'claude_code' },
        { name: 'Codex (self-review)', value: 'codex' },
        { name: 'Skip review', value: null },
      ],
      when: a => a.agents.includes('codex'),
    },
    {
      type: 'list',
      name: 'trigger',
      message: 'Review trigger mode?',
      choices: [
        { name: 'explicit (openairev review)', value: 'explicit' },
        { name: 'auto (every output triggers review)', value: 'auto' },
      ],
    },
    {
      type: 'checkbox',
      name: 'tool_selection',
      message: 'Enable tool gates?',
      choices: [
        { name: 'Tests', value: 'run_tests', checked: true },
        { name: 'Linter', value: 'run_lint', checked: true },
        { name: 'Type checker', value: 'run_typecheck', checked: true },
      ],
    },
    {
      type: 'input',
      name: 'test_cmd',
      message: 'Test command?',
      default: 'npm test',
      when: a => a.tool_selection.includes('run_tests'),
    },
    {
      type: 'input',
      name: 'lint_cmd',
      message: 'Lint command?',
      default: 'npm run lint',
      when: a => a.tool_selection.includes('run_lint'),
    },
    {
      type: 'input',
      name: 'typecheck_cmd',
      message: 'Type check command?',
      default: 'npx tsc --noEmit',
      when: a => a.tool_selection.includes('run_typecheck'),
    },
    {
      type: 'number',
      name: 'claude_iterations',
      message: 'Max iterations when Claude Code executes (Claude→Codex→Claude→... cycles)?',
      default: 5,
      when: a => a.agents.includes('claude_code') && a.claude_reviewer,
    },
    {
      type: 'number',
      name: 'codex_iterations',
      message: 'Max iterations when Codex executes (Codex→Claude→Codex→... cycles)?',
      default: 1,
      when: a => a.agents.includes('codex') && a.codex_reviewer,
    },
  ]);

  // Build config
  const config = {
    agents: {},
    review_policy: {},
    review_trigger: answers.trigger,
    tools: buildToolsConfig(answers),
    session: {
      store_history: true,
      archive_after: '7d',
    },
  };

  if (answers.agents.includes('claude_code')) {
    config.agents.claude_code = {
      cmd: 'claude',
      available: true,
    };
    if (answers.claude_reviewer) {
      config.review_policy.claude_code = {
        reviewer: answers.claude_reviewer,
        max_iterations: answers.claude_iterations ?? 5,
      };
    }
  }

  if (answers.agents.includes('codex')) {
    config.agents.codex = {
      cmd: 'codex',
      available: true,
    };
    if (answers.codex_reviewer) {
      config.review_policy.codex = {
        reviewer: answers.codex_reviewer,
        max_iterations: answers.codex_iterations ?? 1,
      };
    }
  }

  // Write config
  const configDir = getConfigDir(cwd);
  mkdirSync(configDir, { recursive: true });
  mkdirSync(join(configDir, 'sessions'), { recursive: true });
  mkdirSync(join(configDir, 'prompts'), { recursive: true });

  writeFileSync(getConfigPath(cwd), YAML.stringify(config));

  // Copy prompt templates
  const promptsDir = join(configDir, 'prompts');
  copyIfMissing(join(PROMPTS_SRC, 'reviewer.md'), join(promptsDir, 'reviewer.md'));
  copyIfMissing(join(PROMPTS_SRC, 'plan-reviewer.md'), join(promptsDir, 'plan-reviewer.md'));
  copyIfMissing(join(PROMPTS_SRC, 'executor-feedback.md'), join(promptsDir, 'executor-feedback.md'));

  console.log(`\n${chalk.green('✓')} Config written to .openairev/config.yaml`);
  console.log(`${chalk.green('✓')} Prompt templates written to .openairev/prompts/`);
  console.log(`\nRun ${chalk.cyan('openairev review')} to trigger a review.\n`);
}

function buildToolsConfig(answers) {
  const tools = {};
  if (answers.tool_selection?.includes('run_tests')) {
    tools.run_tests = answers.test_cmd || 'npm test';
  }
  if (answers.tool_selection?.includes('run_lint')) {
    tools.run_lint = answers.lint_cmd || 'npm run lint';
  }
  if (answers.tool_selection?.includes('run_typecheck')) {
    tools.run_typecheck = answers.typecheck_cmd || 'npx tsc --noEmit';
  }
  return tools;
}

function copyIfMissing(src, dest) {
  if (!existsSync(dest) && existsSync(src)) {
    copyFileSync(src, dest);
  }
}
