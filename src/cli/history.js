import chalk from 'chalk';
import { listSessions } from '../session/session-manager.js';
import { listChains } from '../session/chain-manager.js';
import { statusColor, stageLabel } from './format-helpers.js';

export async function historyCommand(options) {
  const cwd = process.cwd();
  const limit = options.limit || 10;

  if (options.chains) {
    showChainHistory(cwd, limit);
  } else {
    showSessionHistory(cwd, limit);
  }
}

function showChainHistory(cwd, limit) {
  const chains = listChains(cwd, { limit });

  if (chains.length === 0) {
    console.log(chalk.dim('\nNo workflow chains found.\n'));
    return;
  }

  console.log(chalk.bold(`\nWorkflow Chains (last ${chains.length})\n`));

  for (const c of chains) {
    const date = new Date(c.updated).toLocaleString();
    const executorName = c.participants?.executor || '?';
    const reviewerName = c.participants?.reviewer || '?';
    const roundCount = c.rounds?.length || 0;
    const topic = c.task?.user_request;
    const stage = c.stage ? ` [${stageLabel(c.stage)}]` : '';

    console.log(`  ${chalk.dim(c.chain_id)}`);
    console.log(`    ${date}  ${statusColor(c.status)(c.status)}${chalk.dim(stage)}  ${executorName} ↔ ${reviewerName}`);
    console.log(`    Rounds: ${roundCount}/${c.max_rounds}`);
    if (topic) console.log(`    Topic: ${chalk.dim(topic)}`);

    const lastRound = c.rounds?.[c.rounds.length - 1];
    if (lastRound?.review?.verdict) {
      const v = lastRound.review.verdict;
      console.log(`    Last verdict: ${statusColor(v.status)(v.status)} (${((v.confidence || 0) * 100).toFixed(0)}%)`);
      if (v.critical_issues?.length) {
        console.log(`    ${chalk.red(v.critical_issues.length + ' critical issue(s)')}`);
      }
    }
    console.log('');
  }
}

function showSessionHistory(cwd, limit) {
  const sessions = listSessions(cwd, limit);

  if (sessions.length === 0) {
    console.log(chalk.dim('\nNo review sessions found.\n'));
    return;
  }

  console.log(chalk.bold(`\nReview History (last ${sessions.length})\n`));

  for (const s of sessions) {
    const date = new Date(s.created).toLocaleString();
    const verdict = s.final_verdict;
    const verdictStr = verdict
      ? `${verdict.status} (${((verdict.confidence || 0) * 100).toFixed(0)}%)`
      : 'no verdict';

    console.log(`  ${chalk.dim(s.id)}`);
    console.log(`    ${date}  ${statusColor(s.status)(s.status)}  ${s.executor} → ${s.reviewer}  ${chalk.dim(verdictStr)}`);
    if (verdict?.critical_issues?.length) {
      console.log(`    ${chalk.red(verdict.critical_issues.length + ' critical issue(s)')}`);
    }
    console.log('');
  }
}
