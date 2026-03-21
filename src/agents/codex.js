import { execFile } from 'child_process';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VERDICT_SCHEMA_PATH = join(__dirname, '../config/verdict-schema.json');

export class CodexAdapter {
  constructor(options = {}) {
    this.cmd = options.cmd || 'codex';
    this.sessionId = null;
  }

  /**
   * Run a single review pass. Returns parsed output.
   */
  async run(prompt, { input, useSchema = false, continueSession = false } = {}) {
    const args = ['exec'];

    if (continueSession && this.sessionId) {
      args.push('resume', this.sessionId);
    }

    // Prepend input to prompt if provided and this is a fresh session
    const fullPrompt = input && !continueSession
      ? `${prompt}\n\n--- DIFF ---\n${input}`
      : prompt;

    args.push(fullPrompt);
    args.push('--json');

    if (useSchema) {
      args.push('--output-schema', VERDICT_SCHEMA_PATH);
    }

    const result = await exec(this.cmd, args);

    // Parse NDJSON output — find the last item.completed or turn.completed
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
        } catch {
          // skip non-JSON lines
        }
      }

      if (sessionId && !this.sessionId) {
        this.sessionId = sessionId;
      }

      // Try to parse agent message as JSON (for schema-enforced output)
      if (agentMessage) {
        try {
          return { result: JSON.parse(agentMessage), session_id: this.sessionId };
        } catch {
          return { result: agentMessage, session_id: this.sessionId };
        }
      }

      return { raw: result.stdout, session_id: this.sessionId };
    } catch {
      return { raw: result.stdout, error: 'Failed to parse output' };
    }
  }

  /**
   * Run multi-pass review. Each pass continues the same session.
   */
  async multiPassReview(diff, passes) {
    const results = [];

    for (let i = 0; i < passes.length; i++) {
      const pass = passes[i];
      const isFirst = i === 0;
      const isLast = i === passes.length - 1;

      const result = await this.run(pass.prompt, {
        input: isFirst ? diff : undefined,
        useSchema: isLast,
        continueSession: !isFirst,
      });

      results.push({ pass: i + 1, focus: pass.focus, result });
    }

    return results;
  }
}

function exec(cmd, args) {
  return new Promise((resolve, reject) => {
    const proc = execFile(cmd, args, {
      maxBuffer: 10 * 1024 * 1024,
      timeout: 300_000,
    }, (error, stdout, stderr) => {
      if (error && !stdout) {
        reject(new Error(`${cmd} failed: ${stderr || error.message}`));
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}
