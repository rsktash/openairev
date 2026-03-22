import chalk from 'chalk';

const MAX_PROGRESS_LINES = 200;

const COLORS = {
  cyan: chalk.cyan,
  green: chalk.green,
  yellow: chalk.yellow,
  red: chalk.red,
};

/**
 * Shared factory for NDJSON stream summarizers.
 * Handles buffering, line splitting, progress collection, and TTY output.
 * Each adapter provides its own handleEvent callback.
 */
function createSummarizer({ reviewerName, tty = true, onProgress, handleEvent }) {
  const progressLines = [];
  let buffer = '';
  let started = false;

  const summarizer = (chunk) => {
    if (!started) {
      started = true;
      if (reviewerName) emit(reviewerName, 'cyan');
    }
    buffer += chunk;
    processLines();
  };

  summarizer.getProgress = () => {
    processLines(true);
    return progressLines;
  };

  function processLines(flush = false) {
    const lines = buffer.split('\n');
    buffer = lines.pop();
    if (flush && buffer.trim()) {
      lines.push(buffer);
      buffer = '';
    }

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        handleEvent(JSON.parse(line), emit);
      } catch {
        // skip non-JSON
      }
    }
  }

  function emit(msg, color) {
    if (progressLines.length < MAX_PROGRESS_LINES && progressLines.at(-1) !== msg) {
      progressLines.push(msg);
      if (onProgress) onProgress(progressLines);
    }
    if (tty) {
      const colorFn = COLORS[color] || chalk.dim;
      process.stderr.write(`  ${colorFn(msg)}\n`);
    }
  }

  return summarizer;
}

/**
 * Creates a summarizer callback for Codex NDJSON event streams.
 */
export function createCodexSummarizer({ reviewerName, tty, onProgress } = {}) {
  const seenFiles = new Set();
  return createSummarizer({
    reviewerName: reviewerName && `reviewer: ${reviewerName}`,
    tty,
    onProgress,
    handleEvent: (event, emit) => summarizeCodexEvent(event, seenFiles, { emit }),
  });
}

/**
 * Creates a summarizer callback for Claude stream-json event streams.
 */
export function createClaudeSummarizer({ reviewerName, tty, onProgress } = {}) {
  const seenFiles = new Set();
  const state = { sawMessageStart: false, sawDraft: false, currentToolUse: null };
  return createSummarizer({
    reviewerName: reviewerName && `reviewer: ${reviewerName}`,
    tty,
    onProgress,
    handleEvent: (event, emit) => summarizeClaudeEvent(event, { emit, seenFiles, state }),
  });
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

function summarizeClaudeEvent(wrapper, { emit, seenFiles, state }) {
  if (wrapper.type === 'system' && wrapper.subtype === 'init') {
    emit(`session: ${wrapper.session_id}`);
    return;
  }

  if (wrapper.type === 'assistant' && wrapper.error) {
    emit(`error: ${wrapper.error}`, 'red');
    return;
  }

  if (wrapper.type === 'stream_event') {
    const event = wrapper.event;

    if (event?.type === 'message_start' && !state.sawMessageStart) {
      state.sawMessageStart = true;
      emit('analyzing diff...', 'cyan');
      return;
    }

    if (event?.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
      state.currentToolUse = {
        name: event.content_block.name || 'tool',
        index: event.index,
        input: '',
      };
      return;
    }

    if (event?.type === 'content_block_delta' && event.delta?.type === 'input_json_delta' && state.currentToolUse) {
      state.currentToolUse.input += event.delta.partial_json || '';
      return;
    }

    if (event?.type === 'content_block_stop' && state.currentToolUse) {
      const tool = state.currentToolUse;
      state.currentToolUse = null;
      emitToolSummary(tool, { emit, seenFiles });
      return;
    }

    if (
      event?.type === 'content_block_delta' &&
      event.delta?.type === 'text_delta' &&
      event.delta.text &&
      !state.sawDraft
    ) {
      state.sawDraft = true;
      emit('drafting verdict...', 'cyan');
      return;
    }

    if (event?.type === 'message_delta' && event.usage?.output_tokens != null) {
      emit(`output: ${fmt(event.usage.output_tokens)} tokens`);
      return;
    }
  }

  if (wrapper.type === 'tool_result') {
    if (wrapper.is_error) {
      const name = wrapper.tool_name || 'tool';
      emit(`${name} failed: ${truncate(wrapper.error || 'unknown error', 80)}`, 'yellow');
    }
    return;
  }

  if (wrapper.type === 'result') {
    if (wrapper.is_error) {
      emit(`error: ${wrapper.result || 'unknown error'}`, 'red');
      return;
    }
    emit('verdict ready', 'green');
    if (wrapper.usage) {
      const input = (wrapper.usage.input_tokens || 0) +
        (wrapper.usage.cache_creation_input_tokens || 0) +
        (wrapper.usage.cache_read_input_tokens || 0);
      const output = wrapper.usage.output_tokens || 0;
      emit(`tokens: ${fmt(input + output)} total (${fmt(input)} in / ${fmt(output)} out)`);
    }
  }
}

function emitToolSummary(tool, { emit, seenFiles }) {
  let input;
  try {
    input = tool.input ? JSON.parse(tool.input) : {};
  } catch {
    emit(`running tool: ${tool.name}`);
    return;
  }

  const name = tool.name;

  if (name === 'Read') {
    const file = shortPath(input.file_path);
    if (file && !seenFiles.has(file)) {
      seenFiles.add(file);
      emit(`reading: ${file}`);
    }
    return;
  }

  if (name === 'Glob') {
    emit(`searching: ${input.pattern || 'files'}`);
    return;
  }

  if (name === 'Grep') {
    const target = input.path ? shortPath(input.path) : 'codebase';
    emit(`grep: ${truncate(input.pattern || '', 50)} in ${target}`);
    return;
  }

  if (name === 'Bash') {
    const cmd = input.command || '';
    if (isInternalCmd(cmd)) return;
    const file = extractFileFromCmd(cmd);
    if (file && !seenFiles.has(file)) {
      seenFiles.add(file);
      emit(`reading: ${file}`);
    } else if (!file) {
      const short = summarizeCmd(cmd);
      if (short) emit(`running: ${short}`);
    }
    return;
  }

  if (name === 'Edit' || name === 'Write') {
    const file = shortPath(input.file_path);
    if (file) emit(`writing: ${file}`);
    return;
  }

  emit(`running tool: ${name}`);
}

function shortPath(filePath) {
  if (!filePath) return null;
  return filePath.replace(/^.*\/(?=src\/|lib\/|bin\/|test\/|config\/|packages\/)/, '')
    || filePath.split('/').slice(-2).join('/');
}

function truncate(str, max) {
  return str.length > max ? str.slice(0, max - 3) + '...' : str;
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
