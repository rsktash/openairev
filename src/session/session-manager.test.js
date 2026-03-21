import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { createSession, saveSession, loadSession, listSessions } from './session-manager.js';

const TMP = join(process.cwd(), '.test-tmp-sessions');

describe('session-manager', () => {
  beforeEach(() => {
    mkdirSync(TMP, { recursive: true });
  });

  afterEach(() => {
    rmSync(TMP, { recursive: true, force: true });
  });

  it('creates session with correct structure', () => {
    const session = createSession({
      executor: 'claude_code',
      reviewer: 'codex',
          });

    assert.ok(session.id.startsWith('review_'));
    assert.equal(session.status, 'in_progress');
    assert.equal(session.executor, 'claude_code');
    assert.equal(session.reviewer, 'codex');
    assert.deepEqual(session.iterations, []);
    assert.equal(session.final_verdict, null);
  });

  it('saves and loads session', () => {
    const session = createSession({ executor: 'a', reviewer: 'b', depth: 1 });
    saveSession(session, TMP);

    const loaded = loadSession(session.id, TMP);
    assert.equal(loaded.id, session.id);
    assert.equal(loaded.executor, 'a');
  });

  it('lists sessions sorted by newest first', async () => {
    const s1 = createSession({ executor: 'a', reviewer: 'b', depth: 1 });
    s1.created = '2026-01-01T00:00:00Z';
    saveSession(s1, TMP);

    const s2 = createSession({ executor: 'a', reviewer: 'b', depth: 1 });
    s2.created = '2026-03-01T00:00:00Z';
    saveSession(s2, TMP);

    const list = listSessions(TMP);
    assert.equal(list.length, 2);
    assert.equal(list[0].id, s2.id); // newest first
  });

  it('respects limit', () => {
    for (let i = 0; i < 5; i++) {
      saveSession(createSession({ executor: 'a', reviewer: 'b', depth: 1 }), TMP);
    }
    const list = listSessions(TMP, 3);
    assert.equal(list.length, 3);
  });

  it('returns null for nonexistent session', () => {
    assert.equal(loadSession('nonexistent', TMP), null);
  });

  it('returns empty array when no sessions dir', () => {
    const empty = join(TMP, 'empty');
    mkdirSync(empty, { recursive: true });
    assert.deepEqual(listSessions(empty), []);
  });
});
