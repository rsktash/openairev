import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { exec } from './exec-helper.js';
import { createClaudeSummarizer } from './stream-summarizer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export class ClaudeCodeAdapter {
  constructor(options = {}) {
    this.cmd = options.cmd || 'claude';
    this.cwd = options.cwd || process.cwd();
    this.sessionName = null;
  }

  restoreSession(id) {
    this.sessionName = id;
  }

  async run(prompt, {
    useSchema = false,
    schemaFile = 'verdict-schema.json',
    continueSession = false,
    sessionName = null,
    stream = false,
    signal,
  } = {}) {
    const args = ['-p', prompt, '--max-budget-usd', '5'];

    if (stream) {
      args.push('--output-format', 'stream-json', '--verbose', '--include-partial-messages');
    } else {
      args.push('--output-format', 'json');
    }

    if (useSchema) {
      const schemaPath = join(__dirname, '../config', schemaFile);
      const schema = readFileSync(schemaPath, 'utf-8');
      args.push('--json-schema', schema);
    }

    if (continueSession && this.sessionName) {
      args.push('--resume', this.sessionName);
    } else if (sessionName) {
      args.push('--name', sessionName);
      this.sessionName = sessionName;
    }

    const summarizer = stream ? createClaudeSummarizer({
      reviewerName: stream.reviewerName || 'claude_code',
      tty: stream.tty !== false,
      onProgress: stream.onProgress,
    }) : undefined;

    const result = await exec(this.cmd, args, { onData: summarizer, cwd: this.cwd, signal });

    if (stream) {
      return parseClaudeStreamOutput(result.stdout, {
        progress: summarizer?.getProgress() || [],
        fallbackSessionId: this.sessionName,
      });
    }

    try {
      const parsed = JSON.parse(result.stdout);
      if (!this.sessionName && parsed.session_id) {
        this.sessionName = parsed.session_id;
      }
      return { ...parsed, raw_output: result.stdout };
    } catch {
      return { raw: result.stdout, raw_output: result.stdout, error: 'Failed to parse JSON output' };
    }
  }
}

export function parseClaudeStreamOutput(stdout, { progress = [], fallbackSessionId = null } = {}) {
  let sessionId = fallbackSessionId;
  let assistantText = null;
  let assistantStructuredOutput = null;
  let resultText = null;
  let structuredOutput = null;
  let resultError = null;

  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue;

    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }

    if (!sessionId && event.session_id) {
      sessionId = event.session_id;
    }

    if (event.type === 'assistant') {
      const text = extractAssistantText(event);
      if (text) assistantText = text;
      const toolInput = extractStructuredToolInput(event);
      if (toolInput) assistantStructuredOutput = toolInput;
      if (event.error) resultError = event.error;
    }

    if (event.type === 'result') {
      if (event.structured_output && typeof event.structured_output === 'object') {
        structuredOutput = event.structured_output;
      }
      if (typeof event.result === 'string' && event.result.trim()) {
        resultText = event.result;
      }
      if (event.is_error) {
        resultError = event.result || resultError || 'Claude review failed';
      }
    }
  }

  const finalText = resultText || assistantText;
  const parsed = tryParseJson(finalText);
  const verdict = structuredOutput || assistantStructuredOutput || parsed;

  if (resultError && !verdict) {
    return {
      raw: stdout,
      raw_output: stdout,
      progress,
      session_id: sessionId,
      error: resultError,
    };
  }

  const returnValue = {
    result: verdict || finalText,
    raw_output: stdout,
    progress,
    session_id: sessionId,
  };

  if (!verdict && !finalText) {
    returnValue.error = 'Claude produced no output. Check .openairev/logs/ for the raw session output.';
  }

  return returnValue;
}

function extractAssistantText(event) {
  const parts = event.message?.content;
  if (!Array.isArray(parts)) return null;
  return parts
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('');
}

function extractStructuredToolInput(event) {
  const parts = event.message?.content;
  if (!Array.isArray(parts)) return null;
  const toolUse = parts.find((part) => part?.type === 'tool_use' && part.name === 'StructuredOutput');
  return toolUse?.input && typeof toolUse.input === 'object' ? toolUse.input : null;
}

function tryParseJson(text) {
  if (!text || typeof text !== 'string') return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
