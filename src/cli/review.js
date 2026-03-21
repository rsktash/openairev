import chalk from 'chalk';
import { loadConfig, getReviewer, getReviewDepth, configExists } from '../config/config-loader.js';
import { getDiff } from '../tools/git-tools.js';
import { runToolGates } from '../tools/tool-runner.js';
import { runReview } from '../review/review-runner.js';
import { createSession, saveSession } from '../session/session-manager.js';
import { readFileSync } from 'fs';

export async function reviewCommand(options) {
  const cwd = process.cwd();

  if (!configExists(cwd)) {
    console.log(chalk.red('No .airev/config.yaml found. Run `airev init` first.'));
    process.exit(1);
  }

  const config = loadConfig(cwd);

  // Determine executor and reviewer
  const executor = options.executor || guessExecutor(config);
  const reviewerName = options.reviewer || getReviewer(config, executor);

  if (!reviewerName) {
    console.log(chalk.red(`No reviewer configured for executor "${executor}". Run \`airev init\` or use --reviewer.`));
    process.exit(1);
  }

  const depth = options.depth || getReviewDepth(config, reviewerName);

  console.log(chalk.bold(`\nAIRev Review\n`));
  console.log(`  Executor:  ${chalk.cyan(executor)}`);
  console.log(`  Reviewer:  ${chalk.cyan(reviewerName)}`);
  console.log(`  Depth:     ${chalk.cyan(depth)} pass${depth > 1 ? 'es' : ''}`);

  // Get diff
  let diff;
  if (options.file) {
    console.log(`  Source:    ${chalk.cyan(options.file)}`);
    diff = readFileSync(options.file, 'utf-8');
  } else {
    console.log(`  Source:    ${chalk.cyan('git diff')}`);
    try {
      diff = getDiff(options.diff);
    } catch (e) {
      console.log(chalk.red(`\nFailed to get diff: ${e.message}`));
      process.exit(1);
    }
  }

  if (!diff || !diff.trim()) {
    console.log(chalk.yellow('\nNo changes found. Stage some changes or specify --diff <ref>.'));
    process.exit(0);
  }

  console.log(`  Lines:     ${chalk.cyan(diff.split('\n').length)}`);

  if (options.dryRun) {
    console.log(chalk.yellow('\n[Dry run] Would send the above to reviewer. Exiting.'));
    return;
  }

  // Run tool gates
  if (config.tools?.length) {
    console.log(chalk.dim('\nRunning tool gates...'));
    const toolResults = runToolGates(config.tools, cwd);
    for (const [name, result] of Object.entries(toolResults)) {
      const icon = result.passed ? chalk.green('✓') : chalk.red('✗');
      console.log(`  ${icon} ${name}: ${result.output}`);
    }
  }

  // Create session
  const session = createSession({
    executor,
    reviewer: reviewerName,
    depth,
    diff_ref: options.diff || 'auto',
  });

  // Run review
  console.log(chalk.dim(`\nStarting review (${depth} pass${depth > 1 ? 'es' : ''})...\n`));

  try {
    const review = await runReview(diff, {
      config,
      reviewerName,
      depth,
      cwd,
    });

    // Save results
    session.iterations.push({
      round: 1,
      review,
      timestamp: new Date().toISOString(),
    });

    const verdict = review.verdict;
    session.final_verdict = verdict;
    session.status = verdict ? 'completed' : 'error';
    saveSession(session, cwd);

    // Display verdict
    if (verdict) {
      printVerdict(verdict);
      console.log(chalk.dim(`\nSession saved: ${session.id}`));
    } else {
      console.log(chalk.yellow('\nReviewer did not return a structured verdict.'));
      console.log(chalk.dim('Check the session file for raw output.'));
    }
  } catch (e) {
    session.status = 'error';
    session.error = e.message;
    saveSession(session, cwd);
    console.log(chalk.red(`\nReview failed: ${e.message}`));
    process.exit(1);
  }
}

function printVerdict(verdict) {
  const statusColors = {
    approved: chalk.green,
    needs_changes: chalk.yellow,
    reject: chalk.red,
  };

  const colorFn = statusColors[verdict.status] || chalk.white;
  console.log(chalk.bold('Verdict: ') + colorFn(verdict.status.toUpperCase()));
  console.log(`Risk:    ${verdict.risk_level || 'unknown'}`);
  console.log(`Confidence: ${((verdict.confidence || 0) * 100).toFixed(0)}%\n`);

  if (verdict.critical_issues?.length) {
    console.log(chalk.red.bold('Critical Issues:'));
    verdict.critical_issues.forEach(i => console.log(`  ${chalk.red('•')} ${i}`));
  }

  if (verdict.test_gaps?.length) {
    console.log(chalk.yellow.bold('\nTest Gaps:'));
    verdict.test_gaps.forEach(i => console.log(`  ${chalk.yellow('•')} ${i}`));
  }

  if (verdict.requirement_mismatches?.length) {
    console.log(chalk.yellow.bold('\nRequirement Mismatches:'));
    verdict.requirement_mismatches.forEach(i => console.log(`  ${chalk.yellow('•')} ${i}`));
  }

  if (verdict.repair_instructions?.length) {
    console.log(chalk.cyan.bold('\nRepair Instructions:'));
    verdict.repair_instructions.forEach(i => console.log(`  ${chalk.cyan('→')} ${i}`));
  }

  if (verdict.false_positives_reconsidered?.length) {
    console.log(chalk.dim('\nFalse Positives Dropped:'));
    verdict.false_positives_reconsidered.forEach(i => console.log(`  ${chalk.dim('~')} ${i}`));
  }
}

function guessExecutor(config) {
  // Default: first configured agent
  const agents = Object.keys(config.agents || {}).filter(a => config.agents[a].available);
  return agents[0] || 'claude_code';
}
