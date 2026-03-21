import { execFile } from 'child_process';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VERDICT_SCHEMA_PATH = join(__dirname, '../config/verdict-schema.json');

export class ClaudeCodeAdapter {
  constructor(options = {}) {
    this.cmd = options.cmd || 'claude';
    this.sessionName = null;
  }

  /**
   * Run a single review pass. Returns parsed JSON output.
   * If sessionName is set, continues the existing session.
   */
  async run(prompt, { input, useSchema = false, continueSession = false, sessionName = null } = {}) {
    const args = ['-p', prompt, '--output-format', 'json'];

    if (useSchema) {
      const schema = readFileSync(VERDICT_SCHEMA_PATH, 'utf-8');
      args.push('--json-schema', schema);
    }

    if (continueSession && this.sessionName) {
      args.push('--resume', this.sessionName);
    } else if (sessionName) {
      args.push('--name', sessionName);
      this.sessionName = sessionName;
    }

    const result = await exec(this.cmd, args, input);
    try {
      const parsed = JSON.parse(result.stdout);
      if (!this.sessionName && parsed.session_id) {
        this.sessionName = parsed.session_id;
      }
      return parsed;
    } catch {
      return { raw: result.stdout, error: 'Failed to parse JSON output' };
    }
  }

  /**
   * Run multi-pass review. Each pass continues the same session.
   */
  async multiPassReview(diff, passes, { sessionName } = {}) {
    const results = [];

    for (let i = 0; i < passes.length; i++) {
      const pass = passes[i];
      const isFirst = i === 0;
      const isLast = i === passes.length - 1;

      const prompt = isFirst
        ? `${pass.prompt}\n\n--- DIFF ---\n${diff}`
        : pass.prompt;

      const result = await this.run(prompt, {
        input: isFirst ? diff : undefined,
        useSchema: isLast,
        continueSession: !isFirst,
        sessionName: isFirst ? sessionName : undefined,
      });

      results.push({ pass: i + 1, focus: pass.focus, result });
    }

    return results;
  }
}

function exec(cmd, args, input) {
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

    if (input) {
      proc.stdin.write(input);
      proc.stdin.end();
    }
  });
}
