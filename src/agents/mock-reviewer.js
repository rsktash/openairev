function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildVerdict(schemaFile, status) {
  if (schemaFile === 'plan-verdict-schema.json') {
    return {
      status,
      critical_issues: [],
      missing_requirements: [],
      sequencing_issues: [],
      risks: [],
      risk_level: 'low',
      confidence: 0.99,
      repair_instructions: [],
      false_positives_reconsidered: [
        'Mock reviewer found no plan issues in smoke-test mode.',
      ],
    };
  }

  return {
    status,
    critical_issues: [],
    test_gaps: [],
    requirement_mismatches: [],
    rule_violations: [],
    risk_level: 'low',
    confidence: 0.99,
    repair_instructions: [],
    false_positives_reconsidered: [
      'Mock reviewer found no code issues in smoke-test mode.',
    ],
  };
}

export class MockReviewerAdapter {
  constructor(options = {}) {
    this.cmd = options.cmd || 'mock';
    this.cwd = options.cwd || process.cwd();
    this.sessionId = null;
  }

  restoreSession(id) {
    this.sessionId = id;
  }

  async run(_prompt, {
    schemaFile = 'verdict-schema.json',
    sessionName = null,
    stream = false,
  } = {}) {
    const status = process.env.OPENAIREV_MOCK_REVIEW_STATUS || 'approved';
    const delayMs = Number.parseInt(process.env.OPENAIREV_MOCK_PROGRESS_DELAY_MS || '40', 10);
    const sessionId = this.sessionId || sessionName || `mock-session-${Date.now()}`;
    this.sessionId = sessionId;

    const progress = [
      'reviewer: mock',
      `session: ${sessionId}`,
      'reading diff',
      'verdict ready',
    ];

    if (stream?.onProgress) {
      for (let i = 0; i < progress.length; i++) {
        await delay(delayMs);
        stream.onProgress(progress.slice(0, i + 1));
      }
    }

    const verdict = buildVerdict(schemaFile, status);
    return {
      result: verdict,
      raw_output: JSON.stringify(verdict, null, 2),
      progress,
      session_id: sessionId,
    };
  }
}
