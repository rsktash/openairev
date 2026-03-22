import { readFileSync, existsSync, watchFile, unwatchFile } from 'fs';
import { join } from 'path';

export async function waitCommand() {
  const cwd = process.cwd();
  const progressFile = join(cwd, '.openairev', 'progress.json');

  if (!existsSync(progressFile)) {
    console.log('No review in progress. Call openairev_review first.');
    process.exit(1);
  }

  // Check if already done
  const initial = readProgress(progressFile);
  if (initial?.status === 'completed' || initial?.status === 'error') {
    printResult(initial);
    return;
  }

  // Watch for changes
  let lastLen = 0;
  return new Promise((resolve) => {
    const check = () => {
      const data = readProgress(progressFile);
      if (!data) return;

      // Print new progress lines
      const lines = data.progress || [];
      if (lines.length > lastLen) {
        for (let i = lastLen; i < lines.length; i++) {
          console.log(`  ${lines[i]}`);
        }
        lastLen = lines.length;
      }

      if (data.status === 'completed' || data.status === 'error') {
        unwatchFile(progressFile);
        printResult(data);
        resolve();
      }
    };

    watchFile(progressFile, { interval: 1000 }, check);
    check(); // initial check
  });
}

function readProgress(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

function printResult(data) {
  if (data.status === 'error') {
    console.log(`\nReview failed: ${data.error}`);
    process.exit(1);
  }

  console.log('');
  if (data.executor_feedback) {
    console.log(data.executor_feedback);
  } else if (data.verdict) {
    console.log(JSON.stringify(data.verdict, null, 2));
  }
}
