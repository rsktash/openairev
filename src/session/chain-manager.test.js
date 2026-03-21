import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import {
  createChain, transitionTo, addRound, closeChain, loadChain,
  listChains, getActiveChain, setExecutorSession, getExecutorSession,
  addQuestion, answerQuestion, hasPendingQuestions,
  setPhases, advancePhase, getCurrentPhase, setArtifact,
} from './chain-manager.js';

const TMP = join(process.cwd(), '.test-tmp-chains');

describe('chain-manager', () => {
  beforeEach(() => {
    mkdirSync(TMP, { recursive: true });
  });

  afterEach(() => {
    rmSync(TMP, { recursive: true, force: true });
  });

  it('creates a chain with workflow state', () => {
    const chain = createChain({
      executor: 'claude_code',
      reviewer: 'codex',
      topic: 'auth middleware',
      maxRounds: 3,
      cwd: TMP,
    });

    assert.ok(chain.chain_id.startsWith('chain_'));
    assert.equal(chain.status, 'active');
    assert.equal(chain.stage, 'analyze');
    assert.equal(chain.participants.executor, 'claude_code');
    assert.equal(chain.participants.reviewer, 'codex');
    assert.equal(chain.max_rounds, 3);
    assert.equal(chain.task.user_request, 'auth middleware');
    assert.deepEqual(chain.rounds, []);
    assert.deepEqual(chain.phases, []);
    assert.deepEqual(chain.questions, []);
  });

  it('creates chain with spec ref', () => {
    const chain = createChain({
      executor: 'codex', reviewer: 'claude_code', maxRounds: 1,
      specRef: 'openspec/changes/070_add-admin-dashboard-ui/',
      cwd: TMP,
    });
    assert.equal(chain.task.spec_ref, 'openspec/changes/070_add-admin-dashboard-ui/');
  });

  it('transitions between valid stages', () => {
    const chain = createChain({ executor: 'a', reviewer: 'b', maxRounds: 3, cwd: TMP });

    transitionTo(chain, 'planning', TMP);
    assert.equal(chain.stage, 'planning');
    assert.equal(chain.status, 'active');

    transitionTo(chain, 'plan_review', TMP);
    assert.equal(chain.stage, 'plan_review');

    transitionTo(chain, 'implementation', TMP);
    assert.equal(chain.stage, 'implementation');

    transitionTo(chain, 'code_review', TMP);
    transitionTo(chain, 'code_fix', TMP);
    transitionTo(chain, 'code_review', TMP);
    transitionTo(chain, 'done', TMP);
    assert.equal(chain.status, 'completed');
  });

  it('rejects invalid transitions', () => {
    const chain = createChain({ executor: 'a', reviewer: 'b', maxRounds: 1, cwd: TMP });
    assert.throws(() => transitionTo(chain, 'code_review', TMP), /Invalid transition/);
  });

  it('sets blocked status on awaiting_user', () => {
    const chain = createChain({ executor: 'a', reviewer: 'b', maxRounds: 1, cwd: TMP });
    transitionTo(chain, 'awaiting_user', TMP);
    assert.equal(chain.status, 'blocked');
    assert.equal(chain.stage, 'awaiting_user');
  });

  it('manages questions', () => {
    const chain = createChain({ executor: 'a', reviewer: 'b', maxRounds: 1, cwd: TMP });

    addQuestion(chain, 'Should auth apply to all routes?', TMP);
    assert.equal(chain.questions.length, 1);
    assert.equal(hasPendingQuestions(chain), true);

    answerQuestion(chain, 'q1', 'Only /api/* routes', TMP);
    assert.equal(chain.questions[0].status, 'answered');
    assert.equal(chain.questions[0].answer, 'Only /api/* routes');
    assert.equal(hasPendingQuestions(chain), false);
  });

  it('manages phases', () => {
    const chain = createChain({ executor: 'a', reviewer: 'b', maxRounds: 3, cwd: TMP });

    setPhases(chain, [
      { name: 'Auth middleware', goal: 'Implement middleware' },
      { name: 'Tests', goal: 'Write tests' },
    ], TMP);

    assert.equal(chain.phases.length, 2);
    assert.equal(chain.phase_index, 0);
    assert.equal(getCurrentPhase(chain).name, 'Auth middleware');

    const hasMore = advancePhase(chain, TMP);
    assert.equal(hasMore, true);
    assert.equal(chain.phase_index, 1);
    assert.equal(getCurrentPhase(chain).name, 'Tests');
    assert.equal(chain.phases[0].status, 'approved');

    const hasMore2 = advancePhase(chain, TMP);
    assert.equal(hasMore2, false);
    assert.equal(chain.phases[1].status, 'approved');
  });

  it('adds rounds with kind', () => {
    const chain = createChain({ executor: 'a', reviewer: 'b', maxRounds: 3, cwd: TMP });
    transitionTo(chain, 'planning', TMP);
    transitionTo(chain, 'plan_review', TMP);

    addRound(chain, {
      kind: 'plan_review',
      review: { verdict: { status: 'approved', confidence: 0.9 }, session_id: 'rev-1' },
      cwd: TMP,
    });

    assert.equal(chain.rounds.length, 1);
    assert.equal(chain.rounds[0].kind, 'plan_review');
    assert.equal(chain.rounds[0].result, 'approved');
    assert.equal(chain.sessions.reviewer.plan_review, 'rev-1');
  });

  it('sets and gets executor sessions per stage', () => {
    const chain = createChain({ executor: 'a', reviewer: 'b', maxRounds: 1, cwd: TMP });

    setExecutorSession(chain, 'sess-1', 'analyze', TMP);
    setExecutorSession(chain, 'sess-2', 'implementation', TMP);

    assert.equal(getExecutorSession(chain, 'analyze'), 'sess-1');
    assert.equal(getExecutorSession(chain, 'implementation'), 'sess-2');
  });

  it('sets artifacts', () => {
    const chain = createChain({ executor: 'a', reviewer: 'b', maxRounds: 1, cwd: TMP });
    setArtifact(chain, 'plan', 'Build the thing in 3 steps', TMP);
    const loaded = loadChain(chain.chain_id, TMP);
    assert.equal(loaded.artifacts.plan, 'Build the thing in 3 steps');
  });

  it('persists and loads chain', () => {
    const chain = createChain({ executor: 'a', reviewer: 'b', maxRounds: 2, cwd: TMP });
    const loaded = loadChain(chain.chain_id, TMP);
    assert.equal(loaded.chain_id, chain.chain_id);
    assert.equal(loaded.stage, 'analyze');
  });

  it('lists and filters chains', () => {
    createChain({ executor: 'a', reviewer: 'b', maxRounds: 1, cwd: TMP });
    const c2 = createChain({ executor: 'a', reviewer: 'b', maxRounds: 1, cwd: TMP });
    closeChain(c2, 'completed', TMP);

    const active = listChains(TMP, { status: 'active' });
    assert.equal(active.length, 1);

    const all = listChains(TMP);
    assert.equal(all.length, 2);
  });

  it('getActiveChain finds active or blocked', () => {
    const c1 = createChain({ executor: 'a', reviewer: 'b', maxRounds: 1, cwd: TMP });
    transitionTo(c1, 'awaiting_user', TMP); // blocked

    const active = getActiveChain(TMP);
    assert.ok(active);
    assert.equal(active.status, 'blocked');
  });

  it('returns null when no chains exist', () => {
    assert.equal(getActiveChain(TMP), null);
    assert.deepEqual(listChains(TMP), []);
    assert.equal(loadChain('nonexistent', TMP), null);
  });
});
