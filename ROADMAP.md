# OpenAIRev Roadmap

## Done

- [x] CLI scaffolding (`init`, `review`, `status`, `history`, `resume`)
- [x] Config system (`.openairev/config.yaml`)
- [x] Agent adapters (Claude Code + Codex, non-interactive CLI mode)
- [x] Multi-pass review engine (depth 1-5)
- [x] Schema-enforced verdict output
- [x] Large input staging (file-based for big diffs)
- [x] Reviewer/executor behavioral prompts (peer review framing)
- [x] Review-fix loop (review → feedback → executor fix → re-review)
- [x] Chain manager (executor↔reviewer session pairs)
- [x] Session persistence
- [x] MCP server (bidirectional bridge)
- [x] Unit tests (37 tests)
- [x] README
- [x] CI + npm publish GitHub workflows

## Next

- [ ] End-to-end smoke test — run `openairev init` and `openairev review` against a real diff with real CLIs
- [ ] Add `.test-tmp-*` to `.gitignore`

## Medium Priority

- [ ] Auto trigger mode — `auto` config option (git hook or file watcher to trigger review automatically)
- [ ] `openairev config` command — view/edit config without re-running init
- [ ] Context budget management — summarize older rounds in long chains to avoid blowing context windows
- [ ] Error handling hardening — retry on CLI timeout, handle malformed JSON, graceful fallback on crash

## Future (Phase 4+)

- [ ] Additional agent adapters (Cursor, Aider, Copilot)
- [ ] Specialized reviewer roles (security, performance, architecture)
- [ ] CI integration mode (`openairev review --ci` for automated PR reviews)
- [ ] Custom pass template support in `openairev init`
- [ ] Metrics dashboard (rounds per task, common failure patterns)
- [ ] OpenUISpec integration (review contracts as spec artifacts)
- [ ] Archive/cleanup of old chains (`openairev prune`)
