import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { exec } from './exec-helper.js';

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

  async run(prompt, { useSchema = false, schemaFile = 'verdict-schema.json', continueSession = false, sessionName = null } = {}) {
    const args = ['-p', prompt, '--output-format', 'json'];

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

    const result = await exec(this.cmd, args);
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
}
