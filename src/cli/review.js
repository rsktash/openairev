import chalk from 'chalk';
import { readFileSync } from 'fs';
import { loadConfig, getReviewer, getMaxIterations } from '../config/config-loader.js';
import { getDiff } from '../tools/git-tools.js';
import { runReview } from '../review/review-runner.js';
import { runWorkflow } from '../orchestrator/orchestrator.js';
import { createSession, saveSession } from '../session/session-manager.js';
import { requireConfig, statusColor, stageLabel } from './format-helpers.js';

export async function reviewCommand(options) {
  const cwd = process.cwd();
  requireConfig(cwd);

  const config = loadConfig(cwd);
  const executor = options.executor || guessExecutor(config);
  const reviewerName = options.reviewer || getReviewer(config, executor);

  if (!reviewerName) {
    console.log(chalk.red(`No reviewer configured for executor "${executor}". Run \`openairev init\` or use --reviewer.`));
    process.exit(1);
  }

  const maxRounds = options.rounds || getMaxIterations(config, executor);
  const skipAnalyze = options.once || options.quick;
  const skipPlan = options.once || options.quick || !options.plan;

  console.log(chalk.bold(`\nOpenAIRev\n`));
  console.log(`  Reviewer:    ${chalk.cyan(reviewerName)}`);
  console.log(`  Executor:    ${chalk.dim(executor)}`);
  console.log(`  Max rounds:  ${chalk.cyan(maxRounds)}`);

  if (options.once) {
    console.log(`  Mode:        ${chalk.cyan('single review')}`);
  } else if (options.plan) {
    console.log(`  Mode:        ${chalk.cyan('full workflow (analyze → plan → review → implement)')}`);
  } else {
    console.log(`  Mode:        ${chalk.cyan('implement → review loop')}`);
  }

  let diff = '';
  if (options.file) {
    console.log(`  Source:      ${chalk.cyan(options.file)}`);
    diff = readFileSync(options.file, 'utf-8');
  } else {
    try { diff = getDiff(options.diff); } catch { /* no diff yet is ok for workflow mode */ }
    if (diff?.trim()) console.log(`  Diff lines:  ${chalk.cyan(diff.split('\n').length)}`);
  }

  if (options.specRef) console.log(`  Spec:        ${chalk.cyan(options.specRef)}`);

  if (options.dryRun) {
    console.log(chalk.yellow('\n[Dry run] Would start workflow. Exiting.'));
    return;
  }

  console.log('');

  if (options.once) {
    if (!diff?.trim()) {
      console.log(chalk.yellow('No changes found. Stage some changes or specify --diff <ref>.'));
      process.exit(0);
    }
    try {
      console.log(chalk.dim('Starting review...\n'));
      const review = await runReview(diff, { config, reviewerName, cwd, stream: true });

      const session = createSession({ executor, reviewer: reviewerName, diff_ref: options.diff || 'auto' });
      session.iterations.push({ round: 1, review, timestamp: new Date().toISOString() });
      session.final_verdict = review.verdict;
      session.status = review.verdict ? 'completed' : 'error';
      saveSession(session, cwd);

      if (review.verdict) {
        printVerdict(review.verdict);
        console.log(chalk.dim(`\nSession: ${session.id}`));
      } else {
        console.log(chalk.yellow('\nReviewer did not return a structured verdict.'));
      }
    } catch (e) {
      console.log(chalk.red(`\nReview failed: ${e.message}`));
      process.exit(1);
    }
  } else {
    try {
      const result = await runWorkflow({
        config, executor, reviewerName, maxRounds, diff, diffRef: options.diff,
        taskDescription: options.task, specRef: options.specRef, tools: config.tools,
        cwd, skipAnalyze, skipPlan,
        onStageChange: (stage) => console.log(chalk.bold(`\n[${stageLabel(stage)}]\n`)),
        onRoundEnd: (stage, review, toolResults) => {
          if (toolResults) {
            for (const [name, tr] of Object.entries(toolResults)) {
              const icon = tr.passed ? chalk.green('✓') : chalk.red('✗');
              console.log(`  ${icon} ${name}: ${tr.output}`);
            }
            console.log('');
          }
          if (review.verdict) printVerdict(review.verdict);
        },
      });

      console.log(chalk.bold(`\n${'='.repeat(40)}`));
      console.log(chalk.bold('Workflow Complete\n'));
      console.log(`  Status:  ${statusColor(result.status)(result.status)}`);
      if (result.rounds) console.log(`  Rounds:  ${result.rounds}`);
      if (result.stage) console.log(`  Stage:   ${stageLabel(result.stage)}`);
      console.log(`  Chain:   ${chalk.dim(result.chain.chain_id)}`);
      if (result.message) console.log(`  Note:    ${chalk.yellow(result.message)}`);
      if (result.status === 'blocked') {
        console.log(chalk.yellow(`\nWorkflow waiting for user input. Run \`openairev resume\`.`));
      }
      console.log('');
    } catch (e) {
      console.log(chalk.red(`\nWorkflow failed: ${e.message}`));
      process.exit(1);
    }
  }
}

function printVerdict(verdict) {
  console.log(chalk.bold('Verdict: ') + statusColor(verdict.status)(verdict.status.toUpperCase()));
  console.log(`Risk:       ${verdict.risk_level || 'unknown'}`);
  console.log(`Confidence: ${((verdict.confidence || 0) * 100).toFixed(0)}%\n`);

  const sections = [
    ['critical_issues', chalk.red, 'Critical Issues'],
    ['missing_requirements', chalk.red, 'Missing Requirements'],
    ['test_gaps', chalk.yellow, 'Test Gaps'],
    ['requirement_mismatches', chalk.yellow, 'Requirement Mismatches'],
    ['sequencing_issues', chalk.yellow, 'Sequencing Issues'],
    ['risks', chalk.yellow, 'Risks'],
    ['repair_instructions', chalk.cyan, 'Repair Instructions'],
  ];

  for (const [key, color, label] of sections) {
    if (verdict[key]?.length) {
      console.log(color.bold(`${label}:`));
      verdict[key].forEach(i => console.log(`  ${color('•')} ${i}`));
    }
  }

  if (verdict.false_positives_reconsidered?.length) {
    console.log(chalk.dim('\nFalse Positives Dropped:'));
    verdict.false_positives_reconsidered.forEach(i => console.log(`  ${chalk.dim('~')} ${i}`));
  }
}

function guessExecutor(config) {
  const agents = Object.keys(config.agents || {}).filter(a => config.agents[a].available);
  return agents[0] || 'claude_code';
}
