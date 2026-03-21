import { writeFileSync, readFileSync, existsSync, readdirSync, mkdirSync } from 'fs';
import { join } from 'path';

export function getSessionsDir(cwd = process.cwd()) {
  return join(cwd, '.openairev', 'sessions');
}

/**
 * Save a review session to disk.
 */
export function saveSession(session, cwd = process.cwd()) {
  const dir = getSessionsDir(cwd);
  mkdirSync(dir, { recursive: true });

  const filename = `${session.id}.json`;
  writeFileSync(join(dir, filename), JSON.stringify(session, null, 2));
  return filename;
}

/**
 * Load a session by ID.
 */
export function loadSession(sessionId, cwd = process.cwd()) {
  const filePath = join(getSessionsDir(cwd), `${sessionId}.json`);
  if (!existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, 'utf-8'));
}

/**
 * List all sessions, sorted by most recent.
 */
export function listSessions(cwd = process.cwd(), limit = 20) {
  const dir = getSessionsDir(cwd);
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      try {
        const data = JSON.parse(readFileSync(join(dir, f), 'utf-8'));
        return data;
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.created) - new Date(a.created))
    .slice(0, limit);
}

/**
 * Create a new session object.
 */
export function createSession({ executor, reviewer, diff_ref, task }) {
  return {
    id: `review_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    created: new Date().toISOString(),
    status: 'in_progress',
    executor,
    reviewer,
    diff_ref: diff_ref || null,
    task: task || null,
    iterations: [],
    final_verdict: null,
  };
}
