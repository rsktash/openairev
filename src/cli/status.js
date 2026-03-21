import chalk from 'chalk';
import { listSessions } from '../session/session-manager.js';
import { configExists, loadConfig } from '../config/config-loader.js';

export async function statusCommand() {
  const cwd = process.cwd();

  if (!configExists(cwd)) {
    console.log(chalk.red('No .airev/config.yaml found. Run `airev init` first.'));
    process.exit(1);
  }

  const config = loadConfig(cwd);
  const sessions = listSessions(cwd, 1);

  console.log(chalk.bold('\nAIRev Status\n'));

  // Show config summary
  const agents = Object.entries(config.agents || {})
    .filter(([, v]) => v.available)
    .map(([k]) => k);
  console.log(`  Agents:   ${agents.map(a => chalk.cyan(a)).join(', ') || chalk.dim('none')}`);
  console.log(`  Trigger:  ${chalk.cyan(config.review_trigger)}`);
  console.log(`  Tools:    ${config.tools?.map(t => chalk.dim(t)).join(', ') || chalk.dim('none')}`);

  // Show review policy
  for (const [executor, reviewer] of Object.entries(config.review_policy || {})) {
    const depth = config.agents?.[reviewer]?.review_depth || 1;
    console.log(`  Policy:   ${chalk.cyan(executor)} → reviewed by ${chalk.cyan(reviewer)} (depth ${depth})`);
  }

  // Show last session
  if (sessions.length > 0) {
    const last = sessions[0];
    const ago = timeAgo(new Date(last.created));
    const statusColor = last.status === 'completed' ? chalk.green : last.status === 'error' ? chalk.red : chalk.yellow;
    console.log(`\n  Last review: ${statusColor(last.status)} — ${ago}`);
    if (last.final_verdict) {
      const v = last.final_verdict;
      const vColor = v.status === 'approved' ? chalk.green : v.status === 'needs_changes' ? chalk.yellow : chalk.red;
      console.log(`  Verdict:     ${vColor(v.status)} (${((v.confidence || 0) * 100).toFixed(0)}% confidence)`);
    }
  } else {
    console.log(chalk.dim('\n  No review sessions yet.'));
  }

  console.log('');
}

function timeAgo(date) {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
