import { createAdapter } from '../agents/registry.js';
import { runReview } from '../review/review-runner.js';
import { loadPromptFile } from '../review/prompt-loader.js';
import { getDiff } from '../tools/git-tools.js';
import { runToolGates } from '../tools/tool-runner.js';
import {
  createChain, transitionTo, addRound, setArtifact,
  setExecutorSession, getExecutorSession, getReviewerSession,
  setPhases, closeChain, advancePhase, getCurrentPhase,
  addQuestion,
} from '../session/chain-manager.js';

export async function runWorkflow({
  config,
  executor,
  reviewerName,
  maxRounds,
  diff: initialDiff,
  diffRef,
  taskDescription,
  specRef,
  tools,
  cwd = process.cwd(),
  existingChain = null,
  skipAnalyze = false,
  skipPlan = false,
  onStageChange,
  onRoundEnd,
}) {
  const chain = existingChain || createChain({
    executor,
    reviewer: reviewerName,
    topic: taskDescription,
    maxRounds,
    specRef,
    cwd,
  });

  if (!existingChain) {
    if (skipAnalyze && skipPlan) {
      transitionTo(chain, 'implementation', cwd);
    } else if (skipAnalyze) {
      transitionTo(chain, 'planning', cwd);
    }
  }

  let currentDiff = initialDiff;
  let codeReviewCount = 0;
  let planReviewCount = 0;

  while (chain.status === 'active' || chain.stage === 'done') {
    if (onStageChange) onStageChange(chain.stage, chain);

    switch (chain.stage) {
      case 'analyze': {
        const prompt = buildAnalysisPrompt(chain, specRef);
        const result = await runExecutor(executor, config, prompt, chain, cwd);
        const output = result.output || '';

        setArtifact(chain, 'analysis', output || 'Analysis complete', cwd);

        const questions = extractQuestions(output);
        if (questions.length > 0) {
          for (const q of questions) addQuestion(chain, q, cwd);
          transitionTo(chain, 'awaiting_user', cwd);
        } else if (skipPlan) {
          transitionTo(chain, 'implementation', cwd);
        } else {
          transitionTo(chain, 'planning', cwd);
        }
        break;
      }

      case 'awaiting_user':
        return { chain, status: 'blocked', stage: 'awaiting_user' };

      case 'planning': {
        const prompt = buildPlanPrompt(chain, specRef);
        const result = await runExecutor(executor, config, prompt, chain, cwd);
        const output = result.output || '';

        setArtifact(chain, 'plan', output || 'Plan created', cwd);

        const phases = extractPhases(output);
        if (phases.length > 0) setPhases(chain, phases, cwd);

        transitionTo(chain, 'plan_review', cwd);
        break;
      }

      case 'plan_review': {
        planReviewCount++;
        if (planReviewCount > maxRounds) {
          closeChain(chain, 'error', cwd);
          return { chain, status: 'error', message: 'Plan review exceeded max rounds' };
        }

        const review = await runReviewRound(reviewerName, config, chain.artifacts.plan || '', {
          kind: 'plan_review', chain, cwd,
        });

        addRound(chain, { kind: 'plan_review', review, cwd });

        if (!review.verdict) {
          closeChain(chain, 'error', cwd);
          return { chain, status: 'error', message: 'Plan reviewer did not return a verdict' };
        }

        if (onRoundEnd) onRoundEnd(chain.stage, review);

        if (review.verdict.status === 'approved') {
          transitionTo(chain, 'implementation', cwd);
        } else if (review.verdict.status === 'needs_changes') {
          transitionTo(chain, 'plan_fix', cwd);
        } else {
          closeChain(chain, 'rejected', cwd);
          return { chain, status: 'rejected', message: 'Plan rejected', verdict: review.verdict };
        }
        break;
      }

      case 'plan_fix': {
        const lastVerdict = chain.rounds[chain.rounds.length - 1]?.review?.verdict;
        const feedback = buildFeedback(lastVerdict, cwd);
        const result = await runExecutor(executor, config, feedback, chain, cwd);

        setArtifact(chain, 'plan', result.output || chain.artifacts.plan, cwd);

        const phases = extractPhases(result.output || '');
        if (phases.length > 0) setPhases(chain, phases, cwd);

        transitionTo(chain, 'plan_review', cwd);
        break;
      }

      case 'implementation': {
        const phase = getCurrentPhase(chain);
        if (phase) phase.status = 'in_progress';

        const prompt = buildImplementationPrompt(chain, specRef);
        await runExecutor(executor, config, prompt, chain, cwd);

        try {
          currentDiff = getDiff(diffRef);
        } catch {
          currentDiff = '';
        }

        if (currentDiff?.trim()) {
          setArtifact(chain, 'current_diff_ref', diffRef || 'auto', cwd);
          transitionTo(chain, 'code_review', cwd);
        } else {
          closeChain(chain, 'error', cwd);
          return { chain, status: 'error', message: 'No changes after implementation' };
        }
        break;
      }

      case 'code_review': {
        codeReviewCount++;
        if (codeReviewCount > maxRounds) {
          closeChain(chain, 'max_rounds_reached', cwd);
          return { chain, status: 'max_rounds_reached', rounds: codeReviewCount, verdict: getLastVerdict(chain) };
        }

        let toolResults = null;
        if (tools && typeof tools === 'object' && Object.keys(tools).length > 0) {
          toolResults = runToolGates(Object.keys(tools), cwd, tools);
        }

        const review = await runReviewRound(reviewerName, config, currentDiff, {
          kind: 'code_review', chain, specRef, cwd,
        });

        const phaseId = getCurrentPhase(chain)?.id;
        addRound(chain, { kind: 'code_review', review, toolResults, phaseId, cwd });

        if (!review.verdict) {
          closeChain(chain, 'error', cwd);
          return { chain, status: 'error', message: 'Code reviewer did not return a verdict' };
        }

        if (onRoundEnd) onRoundEnd(chain.stage, review, toolResults);

        if (review.verdict.status === 'approved') {
          const hasMore = advancePhase(chain, cwd);
          if (hasMore) {
            transitionTo(chain, 'implementation', cwd);
          } else {
            // Set stage directly so the done case can execute before status flips
            chain.stage = 'done';
            chain.updated = new Date().toISOString();
          }
        } else if (review.verdict.status === 'needs_changes') {
          transitionTo(chain, 'code_fix', cwd);
        } else {
          closeChain(chain, 'rejected', cwd);
          return { chain, status: 'rejected', rounds: codeReviewCount, verdict: review.verdict };
        }
        break;
      }

      case 'code_fix': {
        const lastVerdict = chain.rounds[chain.rounds.length - 1]?.review?.verdict;
        const feedback = buildFeedback(lastVerdict, cwd);
        await runExecutor(executor, config, feedback, chain, cwd);

        try {
          currentDiff = getDiff(diffRef);
        } catch (e) {
          closeChain(chain, 'error', cwd);
          return { chain, status: 'error', message: `Failed to get diff: ${e.message}` };
        }

        if (!currentDiff?.trim()) {
          closeChain(chain, 'error', cwd);
          return { chain, status: 'error', message: 'No changes after fix attempt' };
        }

        transitionTo(chain, 'code_review', cwd);
        break;
      }

      case 'done': {
        closeChain(chain, 'completed', cwd);
        return { chain, status: 'completed', rounds: codeReviewCount, verdict: getLastVerdict(chain) };
      }

      default: {
        closeChain(chain, 'error', cwd);
        return { chain, status: 'error', message: `Unknown stage: ${chain.stage}` };
      }
    }
  }

  return { chain, status: chain.status, stage: chain.stage };
}

// --- Helpers ---

async function runExecutor(executor, config, prompt, chain, cwd) {
  const adapter = createAdapter(executor, config, { cwd });

  const existingSession = getExecutorSession(chain, chain.stage);
  if (existingSession) adapter.restoreSession(existingSession);

  const result = await adapter.run(prompt, {
    continueSession: !!existingSession,
    sessionName: existingSession ? undefined : `${chain.chain_id}-${chain.stage}`,
  });

  const sessionId = adapter.sessionName || adapter.sessionId || result?.session_id;
  if (sessionId) setExecutorSession(chain, sessionId, chain.stage, cwd);

  return { output: result?.result || result?.raw || null, session_id: sessionId };
}

async function runReviewRound(reviewerName, config, content, { kind, chain, specRef, cwd }) {
  const promptFile = kind === 'plan_review' ? 'plan-reviewer.md' : 'reviewer.md';
  const sessionId = getReviewerSession(chain, kind);

  return runReview(content, {
    config, reviewerName, promptFile,
    taskDescription: chain.task?.user_request,
    specRef: specRef || chain.task?.spec_ref,
    cwd, sessionId,
  });
}

function buildFeedback(verdict, cwd) {
  const feedbackPrompt = loadPromptFile('executor-feedback.md', cwd) ||
    'The following is feedback from an independent AI reviewer. Use your judgment.';

  if (!verdict) return feedbackPrompt;
  return `${feedbackPrompt}\n\n\`\`\`json\n${JSON.stringify(verdict, null, 2)}\n\`\`\`\n\nPlease fix the issues identified above. Edit the files directly.`;
}

function buildAnalysisPrompt(chain, specRef) {
  let prompt = `Analyze the codebase for the following task: ${chain.task?.user_request || 'unknown task'}\n\n`;
  prompt += 'Identify relevant files, dependencies, and potential challenges.\n';
  prompt += 'If you need clarification from the user, list your questions as lines starting with "QUESTION: ".\n';
  prompt += 'Be concise.';
  if (specRef) prompt += `\n\nThe spec for this task is at: ${specRef}\nRead it for requirements and acceptance criteria.`;
  return prompt;
}

function buildPlanPrompt(chain, specRef) {
  let prompt = `Create an implementation plan for: ${chain.task?.user_request || 'unknown task'}\n\n`;
  if (chain.artifacts.analysis) prompt += `Analysis:\n${chain.artifacts.analysis}\n\n`;

  const answered = chain.questions?.filter(q => q.status === 'answered') || [];
  if (answered.length > 0) {
    prompt += 'Clarifications from user:\n';
    for (const q of answered) prompt += `Q: ${q.question}\nA: ${q.answer}\n`;
    prompt += '\n';
  }

  prompt += 'Break the work into phases. For each phase, use this format:\nPHASE: <name>\nGOAL: <goal>\n\n';
  prompt += 'If the task is simple enough for one phase, that is fine.';
  if (specRef) prompt += `\n\nThe spec for this task is at: ${specRef}\nEnsure the plan covers all requirements and scenarios.`;
  return prompt;
}

function buildImplementationPrompt(chain, specRef) {
  const phase = getCurrentPhase(chain);
  let prompt = phase
    ? `Implement phase: ${phase.name}\nGoal: ${phase.goal || phase.name}\n\n`
    : `Implement: ${chain.task?.user_request || 'the task'}\n\n`;

  if (chain.artifacts.plan) prompt += `Plan:\n${chain.artifacts.plan}\n\n`;
  prompt += 'Write the code. Edit files directly.';
  if (specRef) prompt += `\n\nThe spec is at: ${specRef}\nEnsure the implementation satisfies the spec scenarios.`;
  return prompt;
}

function extractQuestions(output) {
  if (!output || typeof output !== 'string') return [];
  return output.split('\n')
    .filter(line => line.trim().startsWith('QUESTION:'))
    .map(line => line.trim().replace(/^QUESTION:\s*/, ''));
}

function extractPhases(output) {
  if (!output || typeof output !== 'string') return [];
  const phases = [];
  const lines = output.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('PHASE:')) {
      const name = line.replace(/^PHASE:\s*/, '').trim();
      let goal = name;
      if (i + 1 < lines.length && lines[i + 1].trim().startsWith('GOAL:')) {
        goal = lines[i + 1].trim().replace(/^GOAL:\s*/, '').trim();
      }
      phases.push({ name, goal });
    }
  }
  return phases;
}

function getLastVerdict(chain) {
  if (chain.rounds.length === 0) return null;
  return chain.rounds[chain.rounds.length - 1].review?.verdict || null;
}
