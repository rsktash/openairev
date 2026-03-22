import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseClaudeStreamOutput } from './claude-code.js';

describe('parseClaudeStreamOutput', () => {
  it('parses a successful stream-json response into a verdict object', () => {
    const stdout = [
      JSON.stringify({
        type: 'system',
        subtype: 'init',
        session_id: 'sess-123',
      }),
      JSON.stringify({
        type: 'assistant',
        session_id: 'sess-123',
        message: {
          content: [{
            type: 'text',
            text: '{"status":"approved","critical_issues":[],"test_gaps":[],"requirement_mismatches":[],"rule_violations":[],"risk_level":"low","confidence":0.99,"repair_instructions":[],"false_positives_reconsidered":[]}',
          }],
        },
      }),
      JSON.stringify({
        type: 'result',
        is_error: false,
        session_id: 'sess-123',
        result: '{"status":"approved","critical_issues":[],"test_gaps":[],"requirement_mismatches":[],"rule_violations":[],"risk_level":"low","confidence":0.99,"repair_instructions":[],"false_positives_reconsidered":[]}',
      }),
    ].join('\n');

    const result = parseClaudeStreamOutput(stdout, { progress: ['reviewer: claude_code'] });

    assert.equal(result.session_id, 'sess-123');
    assert.equal(result.result.status, 'approved');
    assert.deepEqual(result.progress, ['reviewer: claude_code']);
  });

  it('prefers structured_output from the final result event', () => {
    const stdout = [
      JSON.stringify({
        type: 'system',
        subtype: 'init',
        session_id: 'sess-789',
      }),
      JSON.stringify({
        type: 'result',
        is_error: false,
        session_id: 'sess-789',
        result: '',
        structured_output: {
          status: 'approved',
          critical_issues: [],
          test_gaps: [],
          requirement_mismatches: [],
          rule_violations: [],
          risk_level: 'low',
          confidence: 0.98,
          repair_instructions: [],
          false_positives_reconsidered: [],
        },
      }),
    ].join('\n');

    const result = parseClaudeStreamOutput(stdout);

    assert.equal(result.session_id, 'sess-789');
    assert.equal(result.result.status, 'approved');
    assert.equal(result.result.confidence, 0.98);
  });

  it('returns an error when the stream reports failure without a verdict payload', () => {
    const stdout = [
      JSON.stringify({
        type: 'system',
        subtype: 'init',
        session_id: 'sess-456',
      }),
      JSON.stringify({
        type: 'assistant',
        session_id: 'sess-456',
        error: 'authentication_failed',
        message: {
          content: [{ type: 'text', text: 'Not logged in' }],
        },
      }),
      JSON.stringify({
        type: 'result',
        is_error: true,
        session_id: 'sess-456',
        result: 'Not logged in',
      }),
    ].join('\n');

    const result = parseClaudeStreamOutput(stdout);

    assert.equal(result.session_id, 'sess-456');
    assert.equal(result.error, 'Not logged in');
    assert.ok(result.raw_output.includes('authentication_failed'));
  });
});
