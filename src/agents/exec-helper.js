import { execFile } from 'child_process';

export function exec(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, {
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
