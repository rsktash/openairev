import { createServer } from 'http';
import { loadConfig, getReviewer, getReviewDepth } from '../config/config-loader.js';
import { getDiff, getChangedFiles } from '../tools/git-tools.js';
import { runToolGates } from '../tools/tool-runner.js';
import { runReview } from '../review/review-runner.js';
import { createSession, saveSession } from '../session/session-manager.js';

/**
 * MCP Server that exposes review tools via stdio (JSON-RPC).
 * Both Claude Code and Codex can call this as an MCP server.
 */
export function startMcpServer() {
  const cwd = process.cwd();
  const config = loadConfig(cwd);

  // MCP uses stdio — read JSON-RPC from stdin, write to stdout
  let buffer = '';

  process.stdin.setEncoding('utf-8');
  process.stdin.on('data', (chunk) => {
    buffer += chunk;

    // Process complete JSON-RPC messages (newline-delimited)
    const lines = buffer.split('\n');
    buffer = lines.pop(); // Keep incomplete line in buffer

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const request = JSON.parse(line);
        handleRequest(request, config, cwd).then(response => {
          process.stdout.write(JSON.stringify(response) + '\n');
        });
      } catch (e) {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32700, message: 'Parse error' },
          id: null,
        }) + '\n');
      }
    }
  });

  process.stdin.on('end', () => process.exit(0));
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
          serverInfo: { name: 'airev', version: '0.1.0' },
        },
        id,
      };

    case 'notifications/initialized':
      return null; // No response for notifications

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
      name: 'review_code',
      description: 'Send current code changes to an independent AI reviewer for cross-model review. Returns a structured verdict with issues, risk level, and repair instructions.',
      inputSchema: {
        type: 'object',
        properties: {
          executor: {
            type: 'string',
            description: 'Which agent wrote the code (claude_code or codex). Used to select the correct reviewer.',
          },
          diff: {
            type: 'string',
            description: 'The diff or code to review. If omitted, auto-detects from git.',
          },
          depth: {
            type: 'number',
            description: 'Review depth (1-5 passes). Higher = more thorough.',
          },
          task_description: {
            type: 'string',
            description: 'Description of what the code is supposed to do, for requirement checking.',
          },
        },
      },
    },
    {
      name: 'get_review_status',
      description: 'Get the status of the most recent review session.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'run_tests',
      description: 'Run the project test suite and return results.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'run_lint',
      description: 'Run the linter and return results.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'get_diff',
      description: 'Get the current git diff.',
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
      case 'review_code': {
        const executor = args.executor || Object.keys(config.agents).find(a => config.agents[a].available);
        const reviewerName = getReviewer(config, executor);
        if (!reviewerName) {
          return formatResult(`No reviewer configured for executor "${executor}"`);
        }
        const depth = args.depth || getReviewDepth(config, reviewerName);
        const diff = args.diff || getDiff();

        if (!diff.trim()) {
          return formatResult('No changes found to review.');
        }

        const review = await runReview(diff, {
          config,
          reviewerName,
          depth,
          taskDescription: args.task_description,
          cwd,
        });

        // Save session
        const session = createSession({ executor, reviewer: reviewerName, depth });
        session.iterations.push({ round: 1, review, timestamp: new Date().toISOString() });
        session.final_verdict = review.verdict;
        session.status = 'completed';
        saveSession(session, cwd);

        return formatResult(JSON.stringify(review.verdict || review, null, 2));
      }

      case 'get_review_status': {
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

      case 'run_tests': {
        const results = runToolGates(['run_tests'], cwd);
        return formatResult(JSON.stringify(results.tests, null, 2));
      }

      case 'run_lint': {
        const results = runToolGates(['run_lint'], cwd);
        return formatResult(JSON.stringify(results.lint, null, 2));
      }

      case 'get_diff': {
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
