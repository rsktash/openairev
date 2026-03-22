import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createClaudeSummarizer } from './stream-summarizer.js';

function feed(summarizer, events) {
  summarizer(events.map(e => JSON.stringify(e)).join('\n') + '\n');
}

describe('createClaudeSummarizer', () => {
  it('collects useful progress lines from Claude stream-json events', () => {
    const snapshots = [];
    const summarizer = createClaudeSummarizer({
      reviewerName: 'claude_code',
      tty: false,
      onProgress(lines) {
        snapshots.push([...lines]);
      },
    });

    feed(summarizer, [
      { type: 'system', subtype: 'init', session_id: 'sess-123' },
      { type: 'stream_event', event: { type: 'message_start' } },
      { type: 'stream_event', event: {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: '{"status":"approved"' },
      }},
      { type: 'result', is_error: false, usage: { input_tokens: 10, output_tokens: 5 } },
    ]);

    const progress = summarizer.getProgress();

    assert.deepEqual(progress, [
      'reviewer: claude_code',
      'session: sess-123',
      'analyzing diff...',
      'drafting verdict...',
      'verdict ready',
      'tokens: 15 total (10 in / 5 out)',
    ]);
    assert.equal(snapshots.at(-1).at(-1), 'tokens: 15 total (10 in / 5 out)');
  });

  it('tracks tool usage with file dedup', () => {
    const summarizer = createClaudeSummarizer({ tty: false });

    feed(summarizer, [
      { type: 'system', subtype: 'init', session_id: 's1' },
      { type: 'stream_event', event: { type: 'message_start' } },
      // Read tool
      { type: 'stream_event', event: {
        type: 'content_block_start', index: 1,
        content_block: { type: 'tool_use', name: 'Read' },
      }},
      { type: 'stream_event', event: {
        type: 'content_block_delta', index: 1,
        delta: { type: 'input_json_delta', partial_json: '{"file_path":"/home/user/src/version.js"}' },
      }},
      { type: 'stream_event', event: { type: 'content_block_stop', index: 1 } },
      // Second Read of same file — should be deduped
      { type: 'stream_event', event: {
        type: 'content_block_start', index: 2,
        content_block: { type: 'tool_use', name: 'Read' },
      }},
      { type: 'stream_event', event: {
        type: 'content_block_delta', index: 2,
        delta: { type: 'input_json_delta', partial_json: '{"file_path":"/home/user/src/version.js"}' },
      }},
      { type: 'stream_event', event: { type: 'content_block_stop', index: 2 } },
      // Grep tool
      { type: 'stream_event', event: {
        type: 'content_block_start', index: 3,
        content_block: { type: 'tool_use', name: 'Grep' },
      }},
      { type: 'stream_event', event: {
        type: 'content_block_delta', index: 3,
        delta: { type: 'input_json_delta', partial_json: '{"pattern":"VERSION","path":"src/"}' },
      }},
      { type: 'stream_event', event: { type: 'content_block_stop', index: 3 } },
    ]);

    const progress = summarizer.getProgress();

    assert.ok(progress.includes('reading: src/version.js'));
    // Only one "reading" for the same file
    assert.equal(progress.filter(l => l.includes('reading: src/version.js')).length, 1);
    assert.ok(progress.some(l => l.startsWith('grep: VERSION')));
  });

  it('tracks Bash commands and Glob searches', () => {
    const summarizer = createClaudeSummarizer({ tty: false });

    feed(summarizer, [
      { type: 'system', subtype: 'init', session_id: 's2' },
      // Bash tool
      { type: 'stream_event', event: {
        type: 'content_block_start', index: 1,
        content_block: { type: 'tool_use', name: 'Bash' },
      }},
      { type: 'stream_event', event: {
        type: 'content_block_delta', index: 1,
        delta: { type: 'input_json_delta', partial_json: '{"command":"git diff HEAD~1"}' },
      }},
      { type: 'stream_event', event: { type: 'content_block_stop', index: 1 } },
      // Glob tool
      { type: 'stream_event', event: {
        type: 'content_block_start', index: 2,
        content_block: { type: 'tool_use', name: 'Glob' },
      }},
      { type: 'stream_event', event: {
        type: 'content_block_delta', index: 2,
        delta: { type: 'input_json_delta', partial_json: '{"pattern":"**/*.test.js"}' },
      }},
      { type: 'stream_event', event: { type: 'content_block_stop', index: 2 } },
    ]);

    const progress = summarizer.getProgress();

    assert.ok(progress.some(l => l.startsWith('running: git diff')));
    assert.ok(progress.some(l => l === 'searching: **/*.test.js'));
  });

  it('reports tool errors', () => {
    const summarizer = createClaudeSummarizer({ tty: false });

    feed(summarizer, [
      { type: 'tool_result', is_error: true, tool_name: 'Bash', error: 'command not found' },
    ]);

    const progress = summarizer.getProgress();
    assert.ok(progress.some(l => l.includes('Bash failed') && l.includes('command not found')));
  });

  it('handles result errors', () => {
    const summarizer = createClaudeSummarizer({ tty: false });

    feed(summarizer, [
      { type: 'result', is_error: true, result: 'rate limited' },
    ]);

    const progress = summarizer.getProgress();
    assert.ok(progress.some(l => l === 'error: rate limited'));
  });
});
