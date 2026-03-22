import { spawn } from 'child_process';

const MAX_BUFFER = 10 * 1024 * 1024;

export function exec(cmd, args, { onData, cwd, signal } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      timeout: 300_000,
      cwd,
    });

    if (signal) {
      if (signal.aborted) {
        child.kill();
        return reject(new Error(`${cmd} aborted`));
      }
      signal.addEventListener('abort', () => {
        killed = true;
        child.kill();
      }, { once: true });
    }

    const stdoutChunks = [];
    const stderrChunks = [];
    let stdoutLen = 0;
    let stderrLen = 0;
    let killed = false;

    child.stdout.on('data', (chunk) => {
      if (onData) onData(chunk.toString());
      stdoutLen += chunk.length;
      if (stdoutLen <= MAX_BUFFER) {
        stdoutChunks.push(chunk);
      } else if (!killed) {
        killed = true;
        child.kill();
      }
    });

    child.stderr.on('data', (chunk) => {
      stderrLen += chunk.length;
      if (stderrLen <= MAX_BUFFER) {
        stderrChunks.push(chunk);
      } else if (!killed) {
        killed = true;
        child.kill();
      }
    });

    child.on('error', (err) => {
      reject(new Error(`${cmd} failed: ${err.message}`));
    });

    child.on('close', (code) => {
      const stdout = Buffer.concat(stdoutChunks).toString();
      const stderr = Buffer.concat(stderrChunks).toString();
      if (signal?.aborted) {
        reject(new Error(`${cmd} aborted`));
      } else if (killed) {
        reject(new Error(`${cmd} output exceeded ${MAX_BUFFER} bytes`));
      } else if (code !== 0 && !stdout) {
        reject(new Error(`${cmd} failed (exit ${code}): ${stderr}`));
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}
