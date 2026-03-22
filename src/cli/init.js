import { writeFileSync, readFileSync, mkdirSync, copyFileSync, existsSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import inquirer from 'inquirer';
import YAML from 'yaml';
import chalk from 'chalk';
import { getConfigDir, getConfigPath, configExists } from '../config/config-loader.js';
import { detectAgent } from '../agents/detect.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, '../..');
const PROMPTS_SRC = join(PACKAGE_ROOT, 'prompts');
const MCP_SERVER_PATH = join(PACKAGE_ROOT, 'src/mcp/mcp-server.js');

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

  // Configure agent integrations
  if (answers.agents.includes('claude_code')) {
    setupClaudeCode(cwd);
  }
  if (answers.agents.includes('codex')) {
    setupCodex(cwd);
  }

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

/**
 * Set up Claude Code integration:
 * - Add MCP server to .mcp.json (project-level MCP config)
 * - Append instructions to CLAUDE.md
 */
function setupClaudeCode(cwd) {
  // MCP server config — .mcp.json in project root
  setupMcpJson(cwd);

  // CLAUDE.md instructions
  const claudeMdPath = join(cwd, 'CLAUDE.md');
  const marker = '<!-- openairev -->';
  const instructions = `
${marker}
## OpenAIRev — Cross-Model Code Review

This project uses OpenAIRev for independent AI code review. When the user asks to "review", "get a review", or "check my changes":

1. Call \`openairev_review\` with \`executor: "claude_code"\` and \`diff_cmd\` scoped to the files you changed (e.g. \`"git diff HEAD -- src/auth.ts src/routes.ts"\`). The review starts in the background and returns immediately.
2. Call \`openairev_status\` to check progress. It shows what the reviewer is reading and doing. If the review is still running, call it again after a few seconds.
3. When the review is complete, \`openairev_status\` returns the full verdict with feedback.

- **IMPORTANT**: Always use \`diff_cmd\` to scope the diff to your changed files. Do NOT let it auto-detect — the full repo diff may be too large.
- When you receive review feedback, treat it as **peer review** — use your judgment, don't blindly apply every suggestion.
- The review verdict includes \`critical_issues\`, \`repair_instructions\`, and a \`confidence\` score. Focus on high-confidence critical issues.
${marker}
`;

  if (existsSync(claudeMdPath)) {
    const existing = readFileSync(claudeMdPath, 'utf-8');
    if (!existing.includes(marker)) {
      writeFileSync(claudeMdPath, existing + '\n' + instructions.trim() + '\n');
      console.log(`${chalk.green('✓')} OpenAIRev instructions appended to CLAUDE.md`);
    }
  } else {
    writeFileSync(claudeMdPath, instructions.trim() + '\n');
    console.log(`${chalk.green('✓')} CLAUDE.md created with OpenAIRev instructions`);
  }
}

/**
 * Add openairev MCP server to .mcp.json in project root.
 * This is the standard project-level MCP config used by Claude Code and Codex.
 */
function setupMcpJson(cwd) {
  const mcpPath = join(cwd, '.mcp.json');

  let mcpConfig = {};
  if (existsSync(mcpPath)) {
    try { mcpConfig = JSON.parse(readFileSync(mcpPath, 'utf-8')); } catch { /* start fresh */ }
  }

  if (!mcpConfig.mcpServers) mcpConfig.mcpServers = {};

  if (mcpConfig.mcpServers.openairev) return; // already configured

  mcpConfig.mcpServers.openairev = {
    command: 'node',
    args: [MCP_SERVER_PATH],
  };

  writeFileSync(mcpPath, JSON.stringify(mcpConfig, null, 2) + '\n');
  console.log(`${chalk.green('✓')} MCP server added to .mcp.json`);
}

/**
 * Set up Codex CLI integration:
 * - Add MCP server to .mcp.json
 * - Add instructions to AGENTS.md
 */
function setupCodex(cwd) {
  setupMcpJson(cwd);
  const agentsMdPath = join(cwd, 'AGENTS.md');
  const marker = '<!-- openairev -->';
  const instructions = `
${marker}
## OpenAIRev — Cross-Model Code Review

This project uses OpenAIRev for independent AI code review. When the user asks to "review", "get a review", or "check my changes":

1. Call \`openairev_review\` with \`executor: "codex"\` and \`diff_cmd\` scoped to the files you changed (e.g. \`"git diff HEAD -- src/auth.ts src/routes.ts"\`). The review starts in the background and returns immediately.
2. Call \`openairev_status\` to check progress. It shows what the reviewer is reading and doing. If the review is still running, call it again after a few seconds.
3. When the review is complete, \`openairev_status\` returns the full verdict with feedback.

- **IMPORTANT**: Always use \`diff_cmd\` to scope the diff to your changed files. Do NOT let it auto-detect — the full repo diff may be too large.
- When you receive review feedback, treat it as **peer review** — use your judgment, don't blindly apply every suggestion.
- The review verdict includes \`critical_issues\`, \`repair_instructions\`, and a \`confidence\` score. Focus on high-confidence critical issues.
${marker}
`;

  if (existsSync(agentsMdPath)) {
    const existing = readFileSync(agentsMdPath, 'utf-8');
    if (!existing.includes(marker)) {
      writeFileSync(agentsMdPath, existing + '\n' + instructions.trim() + '\n');
      console.log(`${chalk.green('✓')} OpenAIRev instructions appended to AGENTS.md`);
    }
  } else {
    writeFileSync(agentsMdPath, instructions.trim() + '\n');
    console.log(`${chalk.green('✓')} AGENTS.md created with OpenAIRev instructions`);
  }
}
