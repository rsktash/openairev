import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { loadConfig, configExists, getReviewer, getMaxIterations } from './config-loader.js';

const TMP = join(process.cwd(), '.test-tmp-config');

describe('config-loader', () => {
  beforeEach(() => {
    mkdirSync(join(TMP, '.openairev'), { recursive: true });
  });

  afterEach(() => {
    rmSync(TMP, { recursive: true, force: true });
  });

  it('returns defaults when no config file exists', () => {
    const config = loadConfig(TMP);
    assert.equal(config.review_trigger, 'explicit');
    assert.ok(config.agents.claude_code);
    assert.ok(config.agents.codex);
  });

  it('detects config existence', () => {
    assert.equal(configExists(TMP), false);
    writeFileSync(join(TMP, '.openairev', 'config.yaml'), 'review_trigger: auto\n');
    assert.equal(configExists(TMP), true);
  });

  it('loads and merges config with defaults', () => {
    writeFileSync(join(TMP, '.openairev', 'config.yaml'), [
      'review_trigger: auto',
      'review_policy:',
      '  claude_code:',
      '    reviewer: codex',
      '    max_iterations: 5',
    ].join('\n'));

    const config = loadConfig(TMP);
    assert.equal(config.review_trigger, 'auto');
    assert.equal(getReviewer(config, 'claude_code'), 'codex');
    assert.ok(config.agents);
  });

  it('getReviewer works with simple string format', () => {
    const config = { review_policy: { claude_code: 'codex', codex: 'claude_code' } };
    assert.equal(getReviewer(config, 'claude_code'), 'codex');
    assert.equal(getReviewer(config, 'codex'), 'claude_code');
    assert.equal(getReviewer(config, 'unknown'), null);
  });

  it('getReviewer works with object format', () => {
    const config = {
      review_policy: {
        claude_code: { reviewer: 'codex', max_iterations: 5 },
        codex: { reviewer: 'claude_code', max_iterations: 1 },
      },
    };
    assert.equal(getReviewer(config, 'claude_code'), 'codex');
    assert.equal(getReviewer(config, 'codex'), 'claude_code');
  });

  it('getMaxIterations returns per-direction iterations', () => {
    const config = {
      review_policy: {
        claude_code: { reviewer: 'codex', max_iterations: 5 },
        codex: { reviewer: 'claude_code', max_iterations: 1 },
      },
    };
    assert.equal(getMaxIterations(config, 'claude_code'), 5);
    assert.equal(getMaxIterations(config, 'codex'), 1);
  });

  it('getMaxIterations returns default for simple string policy', () => {
    const config = { review_policy: { claude_code: 'codex' } };
    assert.equal(getMaxIterations(config, 'claude_code'), 3);
  });

  it('getMaxIterations returns default for unknown executor', () => {
    assert.equal(getMaxIterations({}, 'unknown'), 3);
  });

  it('deep merges partial config without dropping nested defaults', () => {
    // Only override claude_code agent, codex should still be present from defaults
    writeFileSync(join(TMP, '.openairev', 'config.yaml'), [
      'agents:',
      '  claude_code:',
      '    available: true',
    ].join('\n'));

    const config = loadConfig(TMP);
    assert.equal(config.agents.claude_code.available, true);
    assert.equal(config.agents.claude_code.cmd, 'claude'); // from defaults
    assert.ok(config.agents.codex); // not dropped
    assert.equal(config.agents.codex.cmd, 'codex'); // from defaults
  });

  it('deep merges review_policy without dropping other directions', () => {
    writeFileSync(join(TMP, '.openairev', 'config.yaml'), [
      'review_policy:',
      '  claude_code:',
      '    reviewer: codex',
      '    max_iterations: 10',
    ].join('\n'));

    const config = loadConfig(TMP);
    // Overridden value
    assert.equal(getMaxIterations(config, 'claude_code'), 10);
    // Default for codex direction still present
    assert.equal(getReviewer(config, 'codex'), 'claude_code');
  });
});
