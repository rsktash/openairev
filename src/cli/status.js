import chalk from 'chalk';
import { listSessions } from '../session/session-manager.js';
import { getActiveChain } from '../session/chain-manager.js';
import { loadConfig } from '../config/config-loader.js';
import { requireConfig, statusColor, stageLabel, timeAgo } from './format-helpers.js';

export async function statusCommand() {
  const cwd = process.cwd();
  requireConfig(cwd);

  const config = loadConfig(cwd);

  console.log(chalk.bold('\nOpenAIRev Status\n'));

  const agents = Object.entries(config.agents || {})
    .filter(([, v]) => v.available)
    .map(([k]) => k);
  console.log(`  Agents:   ${agents.map(a => chalk.cyan(a)).join(', ') || chalk.dim('none')}`);
  console.log(`  Trigger:  ${chalk.cyan(config.review_trigger)}`);

  const toolNames = config.tools ? Object.keys(config.tools) : [];
  console.log(`  Tools:    ${toolNames.map(t => chalk.dim(t)).join(', ') || chalk.dim('none')}`);

  for (const [executor, policy] of Object.entries(config.review_policy || {})) {
    const reviewer = typeof policy === 'string' ? policy : policy.reviewer;
    const iterations = typeof policy === 'object' ? policy.max_iterations : null;
    const iterStr = iterations ? ` (max ${iterations} iterations)` : '';
    console.log(`  Policy:   ${chalk.cyan(executor)} → reviewed by ${chalk.cyan(reviewer)}${chalk.dim(iterStr)}`);
  }

  const activeChain = getActiveChain(cwd);
  if (activeChain) {
    const stColor = activeChain.status === 'blocked' ? chalk.yellow : chalk.blue;

    console.log(chalk.bold('\n  Active Workflow'));
    console.log(`    Chain:    ${chalk.dim(activeChain.chain_id)}`);
    console.log(`    Stage:    ${stColor(stageLabel(activeChain.stage))}`);
    console.log(`    Status:   ${statusColor(activeChain.status)(activeChain.status)}`);
    console.log(`    Agents:   ${chalk.cyan(activeChain.participants.executor)} ↔ ${chalk.cyan(activeChain.participants.reviewer)}`);
    console.log(`    Rounds:   ${activeChain.rounds.length}/${activeChain.max_rounds}`);

    if (activeChain.task?.user_request) console.log(`    Task:     ${chalk.dim(activeChain.task.user_request)}`);
    if (activeChain.task?.spec_ref) console.log(`    Spec:     ${chalk.dim(activeChain.task.spec_ref)}`);

    const phase = activeChain.phases?.[activeChain.phase_index];
    if (phase) console.log(`    Phase:    ${phase.name} (${phase.status})`);

    const pending = activeChain.questions?.filter(q => q.status === 'pending') || [];
    if (pending.length > 0) {
      console.log(chalk.yellow.bold('\n    Pending Questions:'));
      pending.forEach(q => console.log(`      ${chalk.yellow('?')} [${q.id}] ${q.question}`));
    }

    const lastRound = activeChain.rounds?.[activeChain.rounds.length - 1];
    if (lastRound?.review?.verdict) {
      const v = lastRound.review.verdict;
      console.log(`\n    Last ${lastRound.kind}: ${statusColor(v.status)(v.status)} (${((v.confidence || 0) * 100).toFixed(0)}%)`);
    }

    console.log(chalk.dim(`\n    Resume with: openairev resume`));
  } else {
    console.log(chalk.dim('\n  No active workflows.'));
  }

  const sessions = listSessions(cwd, 1);
  if (sessions.length > 0) {
    const last = sessions[0];
    const ago = timeAgo(new Date(last.created));
    console.log(`\n  Last review: ${statusColor(last.status)(last.status)} — ${ago}`);
  }

  console.log('');
}
