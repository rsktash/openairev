import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Test verdict extraction logic (mirrors the function in review-runner.js)

describe('verdict extraction', () => {
  function extractVerdict(result) {
    if (!result) return null;

    if (result.structured_output) return result.structured_output;
    if (result.result && typeof result.result === 'object' && result.result.status) return result.result;

    if (result.status && ['approved', 'needs_changes', 'reject'].includes(result.status)) {
      return result;
    }

    const raw = result.result || result.raw || '';
    if (typeof raw === 'string') {
      const jsonMatch = raw.match(/\{[\s\S]*"status"\s*:\s*"(approved|needs_changes|reject)"[\s\S]*\}/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[0]);
        } catch {
          // fall through
        }
      }
    }

    return null;
  }

  it('extracts from structured_output (claude --json-schema)', () => {
    const verdict = extractVerdict({
      structured_output: { status: 'approved', confidence: 0.95, critical_issues: [], risk_level: 'low' },
      result: 'some text',
      session_id: 'abc',
    });
    assert.equal(verdict.status, 'approved');
    assert.equal(verdict.confidence, 0.95);
  });

  it('extracts from nested result object (codex)', () => {
    const verdict = extractVerdict({
      result: { status: 'needs_changes', confidence: 0.7, critical_issues: ['bug'], risk_level: 'high' },
      session_id: 'def',
    });
    assert.equal(verdict.status, 'needs_changes');
    assert.equal(verdict.critical_issues[0], 'bug');
  });

  it('extracts direct verdict object', () => {
    const verdict = extractVerdict(
      { status: 'reject', confidence: 0.3, critical_issues: [], risk_level: 'high' },
    );
    assert.equal(verdict.status, 'reject');
  });

  it('extracts from raw text containing JSON', () => {
    const verdict = extractVerdict({
      raw: 'Here is my verdict:\n{"status": "approved", "critical_issues": [], "risk_level": "low", "confidence": 0.9}\nDone.',
    });
    assert.equal(verdict.status, 'approved');
  });

  it('returns null for missing result', () => {
    assert.equal(extractVerdict(null), null);
    assert.equal(extractVerdict(undefined), null);
  });

  it('returns null for unrecognized format', () => {
    const verdict = extractVerdict({ raw: 'no json here at all' });
    assert.equal(verdict, null);
  });

  it('returns null for invalid status in raw JSON', () => {
    const verdict = extractVerdict({ raw: '{"status": "unknown_status"}' });
    assert.equal(verdict, null);
  });
});

describe('reviewer output logging', () => {
  function logReviewerOutput(rawOutput, reviewerName, cwd) {
    if (!rawOutput) return;
    try {
      const logDir = join(cwd, '.openairev', 'logs');
      mkdirSync(logDir, { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      writeFileSync(join(logDir, `review-${reviewerName}-${ts}.log`), rawOutput);
    } catch {
      // non-critical
    }
  }

  it('writes reviewer output to log file', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'orev-log-'));
    try {
      logReviewerOutput('raw reviewer thinking here', 'codex', tmp);
      const logDir = join(tmp, '.openairev', 'logs');
      assert.ok(existsSync(logDir));
      const files = readdirSync(logDir);
      assert.equal(files.length, 1);
      assert.ok(files[0].startsWith('review-codex-'));
      assert.equal(readFileSync(join(logDir, files[0]), 'utf-8'), 'raw reviewer thinking here');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('skips logging when output is empty', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'orev-log-'));
    try {
      logReviewerOutput('', 'codex', tmp);
      assert.ok(!existsSync(join(tmp, '.openairev', 'logs')));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
