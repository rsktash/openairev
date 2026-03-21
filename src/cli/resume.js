import chalk from 'chalk';
import inquirer from 'inquirer';
import { loadConfig, getMaxIterations } from '../config/config-loader.js';
import { listChains, loadChain, answerQuestion, hasPendingQuestions, transitionTo } from '../session/chain-manager.js';
import { runWorkflow } from '../orchestrator/orchestrator.js';
import { getDiff } from '../tools/git-tools.js';
import { requireConfig, statusColor, stageLabel, timeAgo } from './format-helpers.js';

export async function resumeCommand(options) {
  const cwd = process.cwd();
  requireConfig(cwd);

  const config = loadConfig(cwd);
  let chain;

  if (options.chain) {
    chain = loadChain(options.chain, cwd);
    if (!chain) {
      console.log(chalk.red(`Chain not found: ${options.chain}`));
      process.exit(1);
    }
  } else {
    const allChains = listChains(cwd);
    const resumable = allChains.filter(c => c.status === 'active' || c.status === 'blocked');

    if (resumable.length === 0) {
      if (allChains.length === 0) {
        console.log(chalk.dim('\nNo chains found. Run `openairev review` to start one.\n'));
        return;
      }
      console.log(chalk.dim('\nNo active/blocked chains. Recent chains:\n'));
      for (const c of allChains.slice(0, 5)) {
        const ago = timeAgo(new Date(c.updated));
        console.log(`  ${chalk.dim(c.chain_id)}  ${statusColor(c.status)(c.status)}  ${stageLabel(c.stage)}  ${ago}`);
      }
      console.log('');
      return;
    }

    if (resumable.length === 1) {
      chain = resumable[0];
    } else {
      const { selected } = await inquirer.prompt([{
        type: 'list',
        name: 'selected',
        message: 'Which workflow to resume?',
        choices: resumable.map(c => {
          const ago = timeAgo(new Date(c.updated));
          const label = `${c.task?.user_request || 'untitled'} — ${stageLabel(c.stage)} — ${ago}`;
          return { name: label, value: c.chain_id };
        }),
      }]);
      chain = loadChain(selected, cwd);
    }
  }

  if (!chain) {
    console.log(chalk.red('Failed to load chain.'));
    process.exit(1);
  }

  const executor = chain.participants.executor;
  const reviewerName = chain.participants.reviewer;

  console.log(chalk.bold('\nResuming Workflow\n'));
  console.log(`  Chain:   ${chalk.dim(chain.chain_id)}`);
  console.log(`  Stage:   ${chalk.cyan(stageLabel(chain.stage))}`);
  console.log(`  Status:  ${statusColor(chain.status)(chain.status)}`);
  console.log(`  Agents:  ${chalk.cyan(executor)} ↔ ${chalk.cyan(reviewerName)}`);
  console.log(`  Rounds:  ${chain.rounds.length}/${chain.max_rounds}`);
  if (chain.task?.user_request) console.log(`  Task:    ${chalk.dim(chain.task.user_request)}`);

  // Handle blocked chain — answer pending questions
  if (chain.status === 'blocked' && hasPendingQuestions(chain)) {
    const pending = chain.questions.filter(q => q.status === 'pending');
    console.log(chalk.yellow.bold('\n  Pending questions:\n'));

    for (const q of pending) {
      const { answer } = await inquirer.prompt([{
        type: 'input',
        name: 'answer',
        message: q.question,
      }]);
      answerQuestion(chain, q.id, answer, cwd);
    }

    if (chain.stage === 'awaiting_user') {
      transitionTo(chain, 'planning', cwd);
    }
    console.log(chalk.green('\n  Questions answered. Resuming workflow...\n'));
  }

  let diff = '';
  try { diff = getDiff(); } catch { /* ok */ }

  const codeRoundsDone = chain.rounds.filter(r => r.kind === 'code_review').length;
  if (codeRoundsDone >= chain.max_rounds) {
    console.log(chalk.yellow('\nMax rounds reached. Start a new workflow with `openairev review`.'));
    return;
  }

  try {
    const result = await runWorkflow({
      config, executor, reviewerName, maxRounds: chain.max_rounds,
      diff, taskDescription: chain.task?.user_request,
      specRef: chain.task?.spec_ref, tools: config.tools,
      cwd, existingChain: chain,
      onStageChange: (stage) => console.log(chalk.bold(`\n[${stageLabel(stage)}]\n`)),
      onRoundEnd: (stage, review, toolResults) => {
        if (toolResults) {
          for (const [name, tr] of Object.entries(toolResults)) {
            const icon = tr.passed ? chalk.green('✓') : chalk.red('✗');
            console.log(`  ${icon} ${name}: ${tr.output}`);
          }
        }
        if (review.verdict) {
          const v = review.verdict;
          const color = statusColor(v.status);
          console.log(`  ${color(v.status.toUpperCase())} (${((v.confidence || 0) * 100).toFixed(0)}%)`);
          if (v.critical_issues?.length) {
            v.critical_issues.forEach(i => console.log(`    ${chalk.red('•')} ${i}`));
          }
        }
      },
    });

    console.log(chalk.bold(`\n${'='.repeat(40)}`));
    console.log(`  Status: ${statusColor(result.status)(result.status)}`);
    if (result.message) console.log(`  ${chalk.yellow(result.message)}`);
    console.log('');
  } catch (e) {
    console.log(chalk.red(`\nResume failed: ${e.message}`));
    process.exit(1);
  }
}
