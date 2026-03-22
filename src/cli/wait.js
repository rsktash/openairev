import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { getConfigDir } from '../config/config-loader.js';

export async function waitCommand(options) {
  const progressFile = options.file || join(getConfigDir(), 'progress.json');

  // Wait up to 30s for the progress file to appear (race with MCP server)
  let waited = 0;
  while (!existsSync(progressFile) && waited < 30_000) {
    await sleep(1000);
    waited += 1000;
  }
  if (!existsSync(progressFile)) {
    console.log('No review in progress. Call openairev_review first.');
    process.exit(1);
  }

  let lastLen = 0;

  return new Promise((resolve) => {
    const timer = setInterval(() => {
      const data = readProgress(progressFile);
      if (!data) return;

      const lines = data.progress || [];
      for (let i = lastLen; i < lines.length; i++) {
        console.log(`  ${lines[i]}`);
      }
      lastLen = lines.length;

      if (data.status === 'completed' || data.status === 'error' || data.status === 'cancelled') {
        clearInterval(timer);
        printResult(data);
        resolve();
      }
    }, 2000);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readProgress(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

function printResult(data) {
  if (data.status === 'cancelled') {
    console.log('\nReview cancelled.');
    process.exit(1);
  }
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
