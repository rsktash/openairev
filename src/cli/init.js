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
      message: '.airev/config.yaml already exists. Overwrite?',
      default: false,
    }]);
    if (!overwrite) {
      console.log(chalk.yellow('Init cancelled.'));
      return;
    }
  }

  console.log(chalk.bold('\nAIRev Setup\n'));

  // Detect available CLIs
  const claudeAvailable = await detectAgent('claude');
  const codexAvailable = await detectAgent('codex');

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
      name: 'codex_depth',
      message: 'Codex review depth?',
      choices: [
        { name: '1 — quick single pass', value: 1 },
        { name: '3 — standard', value: 3 },
        { name: '5 — thorough (recommended)', value: 5 },
      ],
      default: 2,
      when: a => a.agents.includes('codex'),
    },
    {
      type: 'list',
      name: 'claude_depth',
      message: 'Claude Code review depth?',
      choices: [
        { name: '1 — quick single pass (recommended)', value: 1 },
        { name: '3 — standard', value: 3 },
        { name: '5 — thorough', value: 5 },
      ],
      default: 0,
      when: a => a.agents.includes('claude_code'),
    },
    {
      type: 'list',
      name: 'trigger',
      message: 'Review trigger mode?',
      choices: [
        { name: 'explicit (airev review)', value: 'explicit' },
        { name: 'auto (every output triggers review)', value: 'auto' },
      ],
    },
    {
      type: 'checkbox',
      name: 'tools',
      message: 'Enable tool gates?',
      choices: [
        { name: 'Tests', value: 'run_tests', checked: true },
        { name: 'Linter', value: 'run_lint', checked: true },
        { name: 'Type checker', value: 'run_typecheck', checked: true },
      ],
    },
    {
      type: 'number',
      name: 'max_rounds',
      message: 'Max review-revision loops?',
      default: 3,
    },
  ]);

  // Build config
  const config = {
    agents: {},
    review_policy: {},
    review_trigger: answers.trigger,
    tools: answers.tools,
    session: {
      max_rounds: answers.max_rounds,
      store_history: true,
      archive_after: '7d',
    },
  };

  if (answers.agents.includes('claude_code')) {
    config.agents.claude_code = {
      cmd: 'claude',
      available: true,
      review_depth: answers.claude_depth ?? 1,
    };
    if (answers.claude_reviewer) {
      config.review_policy.claude_code = answers.claude_reviewer;
    }
  }

  if (answers.agents.includes('codex')) {
    config.agents.codex = {
      cmd: 'codex',
      available: true,
      review_depth: answers.codex_depth ?? 5,
    };
    if (answers.codex_reviewer) {
      config.review_policy.codex = answers.codex_reviewer;
    }
  }

  // Write config
  const configDir = getConfigDir(cwd);
  mkdirSync(configDir, { recursive: true });
  mkdirSync(join(configDir, 'sessions'), { recursive: true });
  mkdirSync(join(configDir, 'prompts', 'review_passes'), { recursive: true });

  writeFileSync(getConfigPath(cwd), YAML.stringify(config));

  // Copy prompt templates
  const promptsDir = join(configDir, 'prompts');
  copyIfMissing(join(PROMPTS_SRC, 'reviewer.md'), join(promptsDir, 'reviewer.md'));
  for (let i = 1; i <= 5; i++) {
    const files = ['pass_1_surface.md', 'pass_2_edge_cases.md', 'pass_3_requirements.md', 'pass_4_reconsider.md', 'pass_5_verdict.md'];
    copyIfMissing(
      join(PROMPTS_SRC, 'review_passes', files[i - 1]),
      join(promptsDir, 'review_passes', files[i - 1])
    );
  }

  console.log(`\n${chalk.green('✓')} Config written to .airev/config.yaml`);
  console.log(`${chalk.green('✓')} Prompt templates written to .airev/prompts/`);
  console.log(`\nRun ${chalk.cyan('airev review')} to trigger a review.\n`);
}

function copyIfMissing(src, dest) {
  if (!existsSync(dest) && existsSync(src)) {
    copyFileSync(src, dest);
  }
}
