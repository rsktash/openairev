import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { stageInput, buildInputReference } from './input-stager.js';

const TMP = join(process.cwd(), '.test-tmp-stager');

describe('input-stager', () => {
  beforeEach(() => {
    mkdirSync(TMP, { recursive: true });
  });

  afterEach(() => {
    rmSync(TMP, { recursive: true, force: true });
  });

  it('inlines small content', () => {
    const result = stageInput('small diff', { cwd: TMP });
    assert.equal(result.mode, 'inline');
    assert.equal(result.content, 'small diff');
  });

  it('writes large content to file', () => {
    const large = 'x'.repeat(10_000);
    const result = stageInput(large, { cwd: TMP });
    assert.equal(result.mode, 'file');
    assert.ok(result.filePath);
    assert.ok(result.relativePath.startsWith('.openairev/tmp/'));
    assert.ok(existsSync(result.filePath));
    assert.equal(readFileSync(result.filePath, 'utf-8'), large);
  });

  it('buildInputReference returns inline content for small input', () => {
    const staged = { mode: 'inline', content: 'diff here' };
    const ref = buildInputReference(staged);
    assert.ok(ref.includes('diff here'));
    assert.ok(ref.includes('--- DIFF ---'));
  });

  it('buildInputReference returns file path for large input', () => {
    const staged = { mode: 'file', relativePath: '.openairev/tmp/test.diff' };
    const ref = buildInputReference(staged);
    assert.ok(ref.includes('.openairev/tmp/test.diff'));
    assert.ok(ref.includes('Read that file'));
  });

  it('uses custom label for filename', () => {
    const large = 'y'.repeat(10_000);
    const result = stageInput(large, { cwd: TMP, label: 'my-review' });
    assert.ok(result.relativePath.includes('my-review'));
  });
});
