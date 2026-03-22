import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MockReviewerAdapter } from './mock-reviewer.js';

describe('MockReviewerAdapter', () => {
  it('returns a code-review verdict with progress updates', async () => {
    const adapter = new MockReviewerAdapter();
    const snapshots = [];

    const result = await adapter.run('review this', {
      stream: {
        onProgress(lines) {
          snapshots.push([...lines]);
        },
      },
    });

    assert.equal(result.result.status, 'approved');
    assert.equal(result.progress.at(-1), 'verdict ready');
    assert.equal(snapshots.length, 4);
    assert.equal(snapshots.at(-1).at(-1), 'verdict ready');
    assert.equal(result.session_id, adapter.sessionId);
  });

  it('returns the plan-review shape when plan schema is requested', async () => {
    const adapter = new MockReviewerAdapter();
    const result = await adapter.run('review this plan', {
      schemaFile: 'plan-verdict-schema.json',
    });

    assert.equal(result.result.status, 'approved');
    assert.deepEqual(result.result.missing_requirements, []);
    assert.deepEqual(result.result.sequencing_issues, []);
    assert.deepEqual(result.result.risks, []);
  });
});
