import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { exec } from './exec-helper.js';
import { createCodexSummarizer } from './stream-summarizer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export class CodexAdapter {
  constructor(options = {}) {
    this.cmd = options.cmd || 'codex';
    this.cwd = options.cwd || process.cwd();
    this.sessionId = null;
  }

  restoreSession(id) {
    this.sessionId = id;
  }

  async run(prompt, { useSchema = false, schemaFile = 'verdict-schema.json', continueSession = false, sessionName = null, stream = false } = {}) {
    const args = ['exec'];

    if (continueSession && this.sessionId) {
      args.push('resume', this.sessionId);
    }

    args.push(prompt);
    args.push('--json');

    if (useSchema) {
      const schemaPath = join(__dirname, '../config', schemaFile);
      args.push('--output-schema', schemaPath);
    }

    const summarizer = stream ? createCodexSummarizer({
      reviewerName: stream.reviewerName || 'codex',
      tty: stream.tty !== false,
    }) : undefined;
    const result = await exec(this.cmd, args, { onData: summarizer });

    try {
      const lines = result.stdout.trim().split('\n');
      let agentMessage = null;
      let sessionId = null;

      for (const line of lines) {
        try {
          const event = JSON.parse(line);
          if (event.type === 'thread.started' && event.thread_id) {
            sessionId = event.thread_id;
          }
          if (event.type === 'item.completed' && event.item?.type === 'agent_message') {
            agentMessage = event.item.text;
          }
          if (event.type === 'error' || event.type === 'turn.failed') {
            const errMsg = event.message || event.error?.message || JSON.stringify(event);
            throw new Error(`Codex error: ${errMsg}`);
          }
        } catch (e) {
          if (e.message?.startsWith('Codex error:')) throw e;
          // skip non-JSON lines
        }
      }

      if (sessionId && !this.sessionId) {
        this.sessionId = sessionId;
      }

      const progress = summarizer?.getProgress() || [];

      if (agentMessage) {
        try {
          return { result: JSON.parse(agentMessage), raw_output: result.stdout, progress, session_id: this.sessionId };
        } catch {
          return { result: agentMessage, raw_output: result.stdout, progress, session_id: this.sessionId };
        }
      }

      return { raw: result.stdout, raw_output: result.stdout, progress, session_id: this.sessionId };
    } catch {
      return { raw: result.stdout, raw_output: result.stdout, error: 'Failed to parse output' };
    }
  }
}
