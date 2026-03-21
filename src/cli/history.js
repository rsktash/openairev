import chalk from 'chalk';
import { listSessions } from '../session/session-manager.js';

export async function historyCommand(options) {
  const cwd = process.cwd();
  const limit = options.limit || 10;
  const sessions = listSessions(cwd, limit);

  if (sessions.length === 0) {
    console.log(chalk.dim('\nNo review sessions found.\n'));
    return;
  }

  console.log(chalk.bold(`\nReview History (last ${sessions.length})\n`));

  for (const s of sessions) {
    const date = new Date(s.created).toLocaleString();
    const statusColors = {
      completed: chalk.green,
      in_progress: chalk.yellow,
      error: chalk.red,
    };
    const colorFn = statusColors[s.status] || chalk.white;

    const verdict = s.final_verdict;
    const verdictStr = verdict
      ? `${verdict.status} (${((verdict.confidence || 0) * 100).toFixed(0)}%)`
      : 'no verdict';

    console.log(`  ${chalk.dim(s.id)}`);
    console.log(`    ${date}  ${colorFn(s.status)}  ${s.executor} → ${s.reviewer}  ${chalk.dim(verdictStr)}`);
    if (verdict?.critical_issues?.length) {
      console.log(`    ${chalk.red(verdict.critical_issues.length + ' critical issue(s)')}`);
    }
    console.log('');
  }
}
