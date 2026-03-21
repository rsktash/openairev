import { loadConfig, getReviewer } from '../config/config-loader.js';
import { getDiff } from '../tools/git-tools.js';
import { runToolGates } from '../tools/tool-runner.js';
import { runReview } from '../review/review-runner.js';
import { createSession, saveSession } from '../session/session-manager.js';

/**
 * MCP Server using stdio with Content-Length framing per MCP spec.
 * Both Claude Code and Codex can call this as an MCP server.
 */
export function startMcpServer() {
  const cwd = process.cwd();
  const config = loadConfig(cwd);

  let buffer = Buffer.alloc(0);

  process.stdin.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    buffer = processBuffer(buffer, config, cwd);
  });

  process.stdin.on('end', () => process.exit(0));
}

/**
 * Parse Content-Length framed messages from buffer.
 * Format: "Content-Length: <N>\r\n\r\n<JSON body of N bytes>"
 */
function processBuffer(buf, config, cwd) {
  while (true) {
    const headerEnd = buf.indexOf('\r\n\r\n');
    if (headerEnd === -1) break;

    const header = buf.slice(0, headerEnd).toString('utf-8');
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) {
      // Fallback: try newline-delimited JSON for compatibility
      const nlIndex = buf.indexOf('\n');
      if (nlIndex === -1) break;
      const line = buf.slice(0, nlIndex).toString('utf-8').trim();
      buf = buf.slice(nlIndex + 1);
      if (line) {
        try {
          const request = JSON.parse(line);
          handleRequest(request, config, cwd).then(response => {
            if (response !== null) sendResponse(response);
          }).catch(() => {});
        } catch {
          // skip malformed
        }
      }
      continue;
    }

    const contentLength = parseInt(match[1], 10);
    const bodyStart = headerEnd + 4;
    if (buf.length < bodyStart + contentLength) break; // incomplete body

    const body = buf.slice(bodyStart, bodyStart + contentLength).toString('utf-8');
    buf = buf.slice(bodyStart + contentLength);

    try {
      const request = JSON.parse(body);
      handleRequest(request, config, cwd).then(response => {
        if (response !== null) sendResponse(response);
      });
    } catch {
      sendResponse({
        jsonrpc: '2.0',
        error: { code: -32700, message: 'Parse error' },
        id: null,
      });
    }
  }
  return buf; // Return unconsumed remainder
}

/**
 * Send a JSON-RPC response with Content-Length framing.
 */
function sendResponse(response) {
  const body = JSON.stringify(response);
  const header = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`;
  process.stdout.write(header + body);
}

async function handleRequest(request, config, cwd) {
  const { method, params, id } = request;

  switch (method) {
    case 'initialize':
      return {
        jsonrpc: '2.0',
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'openairev', version: '0.2.0' },
        },
        id,
      };

    case 'notifications/initialized':
      return null; // Notifications get no response

    case 'tools/list':
      return {
        jsonrpc: '2.0',
        result: {
          tools: getToolDefinitions(),
        },
        id,
      };

    case 'tools/call':
      return {
        jsonrpc: '2.0',
        result: await callTool(params.name, params.arguments || {}, config, cwd),
        id,
      };

    default:
      return {
        jsonrpc: '2.0',
        error: { code: -32601, message: `Method not found: ${method}` },
        id,
      };
  }
}

function getToolDefinitions() {
  return [
    {
      name: 'openairev_review',
      description: 'TRIGGER: Use this tool when the user says "review", "review my code", "get a review", "check my changes", "openairev", or asks for independent/cross-model code review. Sends current code changes to a DIFFERENT AI model for independent review. Returns a structured verdict with critical issues, test gaps, risk level, confidence score, and repair instructions. The reviewer is never the same model as the executor — this ensures unbiased, independent judgment.',
      inputSchema: {
        type: 'object',
        properties: {
          executor: {
            type: 'string',
            description: 'Which agent wrote the code (claude_code or codex). If you are Claude Code, set this to "claude_code". If you are Codex, set this to "codex". This determines which other model will review.',
          },
          diff: {
            type: 'string',
            description: 'The diff or code to review. If omitted, auto-detects from git (staged → unstaged → last commit).',
          },
          task_description: {
            type: 'string',
            description: 'What the code is supposed to do. Used for requirement checking. Include acceptance criteria if available.',
          },
        },
      },
    },
    {
      name: 'openairev_status',
      description: 'Get the status and verdict of the most recent OpenAIRev review session. Use when the user asks "what did the review say", "review status", or "last review results".',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'openairev_run_tests',
      description: 'Run the project test suite and return pass/fail results. Use when user asks to "run tests" or you need to verify code before review.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'openairev_run_lint',
      description: 'Run the project linter and return results.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'openairev_get_diff',
      description: 'Get the current git diff (staged, unstaged, or last commit).',
      inputSchema: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: 'Git ref to diff against' },
        },
      },
    },
  ];
}

async function callTool(name, args, config, cwd) {
  try {
    switch (name) {
      case 'openairev_review': {
        const executor = args.executor || Object.keys(config.agents).find(a => config.agents[a].available);
        const reviewerName = getReviewer(config, executor);
        if (!reviewerName) {
          return formatResult(`No reviewer configured for executor "${executor}"`);
        }
        const diff = args.diff || getDiff();

        if (!diff.trim()) {
          return formatResult('No changes found to review.');
        }

        const review = await runReview(diff, {
          config,
          reviewerName,
          taskDescription: args.task_description,
          cwd,
        });

        // Save session
        const session = createSession({ executor, reviewer: reviewerName });
        session.iterations.push({ round: 1, review, timestamp: new Date().toISOString() });
        session.final_verdict = review.verdict;
        session.status = 'completed';
        saveSession(session, cwd);

        // Return executor-facing feedback (framed as peer review, not user command)
        return formatResult(review.executor_feedback || JSON.stringify(review.verdict || review, null, 2));
      }

      case 'openairev_status': {
        const { listSessions } = await import('../session/session-manager.js');
        const sessions = listSessions(cwd, 1);
        if (sessions.length === 0) {
          return formatResult('No review sessions found.');
        }
        const last = sessions[0];
        return formatResult(JSON.stringify({
          id: last.id,
          status: last.status,
          verdict: last.final_verdict,
          created: last.created,
        }, null, 2));
      }

      case 'openairev_run_tests': {
        const testCmd = config.tools?.run_tests || 'npm test';
        const results = runToolGates(['run_tests'], cwd, { run_tests: testCmd });
        return formatResult(JSON.stringify(results.tests, null, 2));
      }

      case 'openairev_run_lint': {
        const lintCmd = config.tools?.run_lint || 'npm run lint';
        const results = runToolGates(['run_lint'], cwd, { run_lint: lintCmd });
        return formatResult(JSON.stringify(results.lint, null, 2));
      }

      case 'openairev_get_diff': {
        const diff = getDiff(args.ref);
        return formatResult(diff || 'No changes found.');
      }

      default:
        return formatResult(`Unknown tool: ${name}`);
    }
  } catch (e) {
    return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
  }
}

function formatResult(text) {
  return { content: [{ type: 'text', text }] };
}

// If run directly, start the server
if (process.argv[1] && process.argv[1].includes('mcp-server')) {
  startMcpServer();
}
