import { writeFileSync, readFileSync, existsSync, readdirSync, mkdirSync } from 'fs';
import { join } from 'path';

export function getChainsDir(cwd = process.cwd()) {
  return join(cwd, '.openairev', 'chains');
}

// Valid stages and their allowed transitions
const TRANSITIONS = {
  analyze:        ['awaiting_user', 'planning', 'implementation'],
  awaiting_user:  ['planning', 'implementation', 'analyze'],
  planning:       ['plan_review'],
  plan_review:    ['plan_fix', 'implementation', 'error'],
  plan_fix:       ['plan_review'],
  implementation: ['code_review'],
  code_review:    ['code_fix', 'implementation', 'done', 'error'],
  code_fix:       ['code_review'],
  done:           [],
};

/**
 * Create a new chain with full workflow state.
 */
export function createChain({ executor, reviewer, topic, maxRounds, specRef, cwd = process.cwd() }) {
  const dir = getChainsDir(cwd);
  mkdirSync(dir, { recursive: true });

  const chain = {
    chain_id: `chain_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    status: 'active',
    stage: 'analyze',
    task: {
      user_request: topic || null,
      spec_ref: specRef || null,
    },
    participants: {
      executor,
      reviewer,
    },
    max_rounds: maxRounds,
    phase_index: 0,
    phases: [],
    artifacts: {
      analysis: null,
      plan: null,
      plan_review: null,
      current_diff_ref: null,
    },
    rounds: [],
    questions: [],
    sessions: {
      executor: {},
      reviewer: {},
    },
  };

  saveChain(chain, cwd);
  return chain;
}

/**
 * Transition chain to a new stage. Validates the transition is allowed.
 */
export function transitionTo(chain, newStage, cwd = process.cwd()) {
  const allowed = TRANSITIONS[chain.stage];
  if (!allowed || !allowed.includes(newStage)) {
    throw new Error(`Invalid transition: ${chain.stage} → ${newStage}. Allowed: ${allowed?.join(', ')}`);
  }

  chain.stage = newStage;
  chain.updated = new Date().toISOString();

  // Set chain status based on stage
  if (newStage === 'done') {
    chain.status = 'completed';
  } else if (newStage === 'awaiting_user') {
    chain.status = 'blocked';
  } else if (newStage === 'error') {
    chain.status = 'error';
  } else {
    chain.status = 'active';
  }

  saveChain(chain, cwd);
  return chain;
}

/**
 * Record a completed review round (plan or code).
 */
export function addRound(chain, { kind, review, toolResults, phaseId, cwd = process.cwd() }) {
  chain.updated = new Date().toISOString();

  chain.rounds.push({
    round: chain.rounds.length + 1,
    kind: kind || 'code_review',
    phase_id: phaseId || chain.phases[chain.phase_index]?.id || null,
    timestamp: new Date().toISOString(),
    review: {
      verdict: review.verdict,
    },
    tool_results: toolResults || null,
    result: review.verdict?.status || null,
  });

  // Update reviewer session ID
  if (review.session_id) {
    chain.sessions.reviewer[kind || 'code_review'] = review.session_id;
  }

  saveChain(chain, cwd);
  return chain;
}

/**
 * Set an artifact on the chain.
 */
export function setArtifact(chain, key, value, cwd = process.cwd()) {
  chain.artifacts[key] = value;
  chain.updated = new Date().toISOString();
  saveChain(chain, cwd);
}

/**
 * Set executor session ID for the current stage.
 */
export function setExecutorSession(chain, sessionId, stage, cwd = process.cwd()) {
  chain.sessions.executor[stage || chain.stage] = sessionId;
  chain.updated = new Date().toISOString();
  saveChain(chain, cwd);
}

/**
 * Get the executor session ID for a given stage (or latest).
 */
export function getExecutorSession(chain, stage) {
  if (stage) return chain.sessions.executor[stage] || null;
  // Return the most recently set session
  const stages = Object.keys(chain.sessions.executor);
  return stages.length > 0 ? chain.sessions.executor[stages[stages.length - 1]] : null;
}

/**
 * Get the reviewer session ID for a given review kind (or latest).
 */
export function getReviewerSession(chain, kind) {
  if (kind) return chain.sessions.reviewer[kind] || null;
  const kinds = Object.keys(chain.sessions.reviewer);
  return kinds.length > 0 ? chain.sessions.reviewer[kinds[kinds.length - 1]] : null;
}

/**
 * Add a question that blocks the chain.
 */
export function addQuestion(chain, question, cwd = process.cwd()) {
  chain.questions.push({
    id: `q${chain.questions.length + 1}`,
    question,
    answer: null,
    status: 'pending',
  });
  chain.updated = new Date().toISOString();
  saveChain(chain, cwd);
  return chain.questions[chain.questions.length - 1];
}

/**
 * Answer a pending question. If all answered, chain can proceed.
 */
export function answerQuestion(chain, questionId, answer, cwd = process.cwd()) {
  const q = chain.questions.find(q => q.id === questionId);
  if (!q) throw new Error(`Question not found: ${questionId}`);
  q.answer = answer;
  q.status = 'answered';
  chain.updated = new Date().toISOString();
  saveChain(chain, cwd);
  return q;
}

/**
 * Check if chain has unanswered questions.
 */
export function hasPendingQuestions(chain) {
  return chain.questions.some(q => q.status === 'pending');
}

/**
 * Add or update phases on the chain.
 */
export function setPhases(chain, phases, cwd = process.cwd()) {
  chain.phases = phases.map((p, i) => ({
    id: p.id || `phase_${i + 1}`,
    name: p.name,
    goal: p.goal || null,
    status: p.status || 'pending',
  }));
  chain.phase_index = 0;
  chain.updated = new Date().toISOString();
  saveChain(chain, cwd);
}

/**
 * Advance to the next phase. Returns true if there's a next phase.
 */
export function advancePhase(chain, cwd = process.cwd()) {
  if (chain.phase_index < chain.phases.length - 1) {
    chain.phases[chain.phase_index].status = 'approved';
    chain.phase_index += 1;
    chain.phases[chain.phase_index].status = 'in_progress';
    chain.updated = new Date().toISOString();
    saveChain(chain, cwd);
    return true;
  }
  // Final phase done
  if (chain.phases.length > 0) {
    chain.phases[chain.phase_index].status = 'approved';
    saveChain(chain, cwd);
  }
  return false;
}

/**
 * Get current phase, or null if no phases defined.
 */
export function getCurrentPhase(chain) {
  if (!chain.phases || chain.phases.length === 0) return null;
  return chain.phases[chain.phase_index] || null;
}

/**
 * Close chain with a final status.
 */
export function closeChain(chain, status, cwd = process.cwd()) {
  chain.status = status;
  chain.stage = status === 'completed' ? 'done' : chain.stage;
  chain.updated = new Date().toISOString();
  chain.final_verdict = chain.rounds.length > 0
    ? chain.rounds[chain.rounds.length - 1].review.verdict
    : null;
  saveChain(chain, cwd);
}

/**
 * Load a chain by ID.
 */
export function loadChain(chainId, cwd = process.cwd()) {
  const filePath = join(getChainsDir(cwd), `${chainId}.json`);
  if (!existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, 'utf-8'));
}

/**
 * List all chains, optionally filtered by status.
 */
export function listChains(cwd = process.cwd(), { status, limit = 20 } = {}) {
  const dir = getChainsDir(cwd);
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      try {
        return JSON.parse(readFileSync(join(dir, f), 'utf-8'));
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .filter(c => !status || c.status === status)
    .sort((a, b) => new Date(b.updated) - new Date(a.updated))
    .slice(0, limit);
}

/**
 * Get the most recent active or blocked chain.
 */
export function getActiveChain(cwd = process.cwd()) {
  const chains = listChains(cwd, { limit: 20 });
  return chains.find(c => c.status === 'active' || c.status === 'blocked') || null;
}

let dirEnsured = false;
function saveChain(chain, cwd) {
  const dir = getChainsDir(cwd);
  if (!dirEnsured) {
    mkdirSync(dir, { recursive: true });
    dirEnsured = true;
  }
  writeFileSync(join(dir, `${chain.chain_id}.json`), JSON.stringify(chain, null, 2));
}
