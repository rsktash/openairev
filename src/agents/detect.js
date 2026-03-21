import { execFile } from 'child_process';

export function detectAgent(cmd) {
  return new Promise((resolve) => {
    execFile('which', [cmd], (error) => {
      resolve(!error);
    });
  });
}
