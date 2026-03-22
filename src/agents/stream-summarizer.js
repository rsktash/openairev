import chalk from 'chalk';

/**
 * Creates a summarizer callback for Codex NDJSON event streams.
 * tty=true: prints colored progress to stderr.
 * tty=false: collects plain-text progress lines silently.
 * Both modes always collect lines for the final summary.
 */
export function createCodexSummarizer({ reviewerName, tty = true, onProgress } = {}) {
  const seenFiles = new Set();
  const progressLines = [];
  let buffer = '';
  let started = false;

  const summarizer = (chunk) => {
    if (!started) {
      started = true;
      if (reviewerName) emit(`reviewer: ${reviewerName}`, 'cyan');
    }
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        summarizeCodexEvent(event, seenFiles, { emit });
      } catch {
        // skip non-JSON
      }
    }
  };

  summarizer.getProgress = () => progressLines;

  function emit(msg, color) {
    if (progressLines.length < 200) {
      progressLines.push(msg);
      if (onProgress) onProgress(progressLines);
    }
    if (tty) {
      const colorFn = color === 'cyan' ? chalk.cyan
        : color === 'green' ? chalk.green
        : color === 'yellow' ? chalk.yellow
        : color === 'red' ? chalk.red
        : chalk.dim;
      process.stderr.write(`  ${colorFn(msg)}\n`);
    }
  }

  return summarizer;
}

function summarizeCodexEvent(event, seenFiles, { emit }) {
  const type = event.type;

  if (type === 'thread.started') {
    emit(`session: ${event.thread_id}`);
  }

  if (type === 'item.started' && event.item?.type === 'todo_list') {
    const items = event.item.items?.map(i => i.text) || [];
    emit('plan:', 'cyan');
    for (const item of items) emit(`  • ${item}`);
  }

  if (type === 'item.completed' && event.item?.type === 'todo_list') {
    const items = event.item.items || [];
    const done = items.filter(i => i.completed).length;
    emit(`progress: ${done}/${items.length} tasks done`);
  }

  if (type === 'item.started' && event.item?.type === 'command_execution') {
    const cmd = event.item.command || '';
    if (isInternalCmd(cmd)) return;
    const file = extractFileFromCmd(cmd);
    if (file && !seenFiles.has(file)) {
      seenFiles.add(file);
      emit(`reading: ${file}`);
    } else if (!file) {
      const short = summarizeCmd(cmd);
      if (short) emit(`running: ${short}`);
    }
  }

  if (type === 'item.completed' && event.item?.type === 'command_execution') {
    const exit = event.item.exit_code;
    if (exit !== null && exit !== 0) {
      const cmd = summarizeCmd(event.item.command || '');
      emit(`command failed (exit ${exit}): ${cmd}`, 'yellow');
    }
  }

  if (type === 'item.started' && event.item?.type === 'agent_message') {
    emit('generating verdict...', 'cyan');
  }

  if (type === 'item.completed' && event.item?.type === 'agent_message') {
    emit('verdict ready', 'green');
  }

  if (type === 'turn.completed' && event.usage) {
    const { input_tokens, output_tokens } = event.usage;
    const total = input_tokens + output_tokens;
    emit(`tokens: ${fmt(total)} total (${fmt(input_tokens)} in / ${fmt(output_tokens)} out)`);
  }

  if (type === 'error' || type === 'turn.failed') {
    const msg = event.message || event.error?.message || 'unknown error';
    emit(`error: ${msg}`, 'red');
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
