#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = resolve(__dirname, '..');
const serverPath = join(repoRoot, 'src', 'mcp', 'mcp-server.js');
const waitCliPath = join(repoRoot, 'bin', 'openairev.js');

function writeConfig(tmpRoot) {
  const configDir = join(tmpRoot, '.openairev');
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, 'config.yaml'), [
    'review_policy:',
    '  claude_code: mock',
    'agents:',
    '  claude_code:',
    '    cmd: claude',
    '    available: true',
    '  mock:',
    '    cmd: mock',
    '    available: true',
    '',
  ].join('\n'));
  return join(configDir, 'progress.json');
}

function extractText(result) {
  return (result.content || [])
    .filter((item) => item.type === 'text')
    .map((item) => item.text)
    .join('\n---\n');
}

function runWaitCommand(waitFile, cwd) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [waitCliPath, 'wait', '--file', waitFile], {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`wait command failed (${code}): ${stderr || stdout}`));
        return;
      }
      resolvePromise(stdout);
    });
  });
}

async function main() {
  const keepTemp = process.argv.includes('--keep-temp');
  const tmpRoot = mkdtempSync(join(tmpdir(), 'openairev-mcp-smoke-'));
  const progressFile = writeConfig(tmpRoot);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    cwd: tmpRoot,
    env: {
      ...process.env,
      OPENAIREV_MOCK_PROGRESS_DELAY_MS: '25',
    },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'openairev-smoke', version: '1.0.0' }, { capabilities: {} });

  let stderr = '';
  transport.stderr?.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  try {
    await client.connect(transport);

    const tools = await client.listTools();
    const toolNames = tools.tools.map((tool) => tool.name);
    assert.deepEqual(toolNames.sort(), [
      'openairev_get_diff',
      'openairev_review',
      'openairev_run_lint',
      'openairev_run_tests',
      'openairev_status',
    ]);

    const diff = [
      'diff --git a/src/version.js b/src/version.js',
      'index 1111111..2222222 100644',
      '--- a/src/version.js',
      '+++ b/src/version.js',
      '@@ -1 +1 @@',
      "-export const VERSION = '0.3.5';",
      "+export const VERSION = '0.3.6';",
      '',
    ].join('\n');

    const start = await client.callTool({
      name: 'openairev_review',
      arguments: {
        executor: 'claude_code',
        diff,
        task_description: 'Smoke-test review path.',
      },
    });
    assert.match(extractText(start), /Review started\./);

    let lastStatus = '';
    for (let i = 0; i < 40; i++) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
      const status = await client.callTool({ name: 'openairev_status', arguments: {} });
      lastStatus = extractText(status);
      if (lastStatus.includes('Review complete:')) {
        break;
      }
    }

    assert.match(lastStatus, /Review complete:/);
    assert.ok(existsSync(progressFile), 'progress.json should be written');

    const progress = JSON.parse(readFileSync(progressFile, 'utf-8'));
    assert.equal(progress.status, 'completed');
    assert.equal(progress.reviewer, 'mock');
    assert.equal(progress.verdict.status, 'approved');
    assert.ok(progress.progress.length >= 4, 'progress lines should be persisted');

    const waitOutput = await runWaitCommand(progressFile, tmpRoot);
    assert.match(waitOutput, /reviewer: mock/);
    assert.match(waitOutput, /"status": "approved"/);

    console.log(`MCP smoke test passed. Temp dir: ${tmpRoot}`);
  } finally {
    await transport.close().catch(() => {});
    if (!keepTemp) {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  }

  if (stderr.trim()) {
    console.error(stderr.trim());
  }
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
