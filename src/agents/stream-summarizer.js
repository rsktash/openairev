import chalk from 'chalk';

/**
 * Creates a summarizer callback for Codex NDJSON event streams.
 * Prints concise progress lines to stderr instead of raw JSON.
 */
export function createCodexSummarizer({ reviewerName } = {}) {
  const seenFiles = new Set();
  let buffer = '';
  let started = false;

  return (chunk) => {
    if (!started) {
      started = true;
      if (reviewerName) log(chalk.cyan(`  reviewer: ${reviewerName}`));
    }
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop(); // keep incomplete last line

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        summarizeCodexEvent(event, seenFiles);
      } catch {
        // skip non-JSON
      }
    }
  };
}

function summarizeCodexEvent(event, seenFiles) {
  const type = event.type;

  if (type === 'thread.started') {
    log(chalk.dim(`  session: ${event.thread_id}`));
  }

  if (type === 'item.started' && event.item?.type === 'todo_list') {
    const items = event.item.items?.map(i => i.text) || [];
    log(chalk.cyan('  plan:'));
    for (const item of items) log(chalk.dim(`    • ${item}`));
  }

  if (type === 'item.completed' && event.item?.type === 'todo_list') {
    const items = event.item.items || [];
    const done = items.filter(i => i.completed).length;
    log(chalk.dim(`  progress: ${done}/${items.length} tasks done`));
  }

  if (type === 'item.started' && event.item?.type === 'command_execution') {
    const cmd = event.item.command || '';
    if (isInternalCmd(cmd)) return;
    const file = extractFileFromCmd(cmd);
    if (file && !seenFiles.has(file)) {
      seenFiles.add(file);
      log(chalk.dim(`  reading: ${file}`));
    } else if (!file) {
      const short = summarizeCmd(cmd);
      if (short) log(chalk.dim(`  running: ${short}`));
    }
  }

  if (type === 'item.completed' && event.item?.type === 'command_execution') {
    const exit = event.item.exit_code;
    if (exit !== null && exit !== 0) {
      const cmd = summarizeCmd(event.item.command || '');
      log(chalk.yellow(`  command failed (exit ${exit}): ${cmd}`));
    }
  }

  if (type === 'item.started' && event.item?.type === 'agent_message') {
    log(chalk.cyan('  generating verdict...'));
  }

  if (type === 'item.completed' && event.item?.type === 'agent_message') {
    log(chalk.green('  verdict ready'));
  }

  if (type === 'turn.completed' && event.usage) {
    const { input_tokens, output_tokens } = event.usage;
    const total = input_tokens + output_tokens;
    log(chalk.dim(`  tokens: ${fmt(total)} total (${fmt(input_tokens)} in / ${fmt(output_tokens)} out)`));
  }

  if (type === 'error' || type === 'turn.failed') {
    const msg = event.message || event.error?.message || 'unknown error';
    log(chalk.red(`  error: ${msg}`));
  }
}

function isInternalCmd(cmd) {
  return /node\s+-e\s/.test(cmd) ||
    /require\(['"]child_process['"]\)/.test(cmd) ||
    /spawn\(/.test(cmd) ||
    /execFile\(/.test(cmd) ||
    /process\.exec/.test(cmd) ||
    /<<'NODE'/.test(cmd) ||
    /echo\s/.test(cmd);
}

function extractFileFromCmd(cmd) {
  const match = cmd.match(/(?:cat|sed|nl|head|tail|less)\s+(?:-[^\s]*\s+)*([^\s|>"']+\.\w+)/);
  if (match) return match[1];
  const match2 = cmd.match(/\s([a-zA-Z][\w/.-]+\.\w{1,5})(?:\s|$|\|)/);
  return match2 ? match2[1] : null;
}

function summarizeCmd(cmd) {
  const inner = cmd.replace(/^\/bin\/\w+\s+-\w+\s+["'](.+)["']$/, '$1');
  const clean = inner.replace(/\\"/g, '"').trim();
  return clean.length > 80 ? clean.slice(0, 77) + '...' : clean;
}

function fmt(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
  return String(n);
}

function log(msg) {
  process.stderr.write(msg + '\n');
}
