# Implementation Plan: Jira Auto-Update

## Overview

This plan implements a Git hook + Kiro Agent Hook system that keeps Jira tickets in sync with development activity. The approach is incremental: set up project structure and core utilities first, then build each domain component (extraction, summarization, Jira communication), wire them into orchestrators, and finally create the Git hook scripts and Kiro hook configuration.

## Tasks

- [ ] 1. Set up project structure and core utilities
  - [ ] 1.1 Initialize project with package.json, tsconfig.json, and dependencies
    - Create `package.json` with name, scripts (build, test, lint), and dependencies: `dotenv`, `axios`
    - Add devDependencies: `typescript`, `vitest`, `fast-check`, `@types/node`
    - Create `tsconfig.json` with strict mode, ESNext module, outDir `dist/`
    - Create `.gitignore` with `node_modules/`, `dist/`, `.env`
    - Create `.env.example` with placeholder keys: `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`
    - _Requirements: 6.1, 6.3, 6.7_

  - [ ] 1.2 Implement Logger (`src/logger.ts`)
    - Implement `info(ticketId, message)` → stdout with `[jira-hook]` prefix
    - Implement `warn(ticketId, message)` → stderr with `[jira-hook]` prefix
    - Implement `error(ticketId, message)` → stderr with `[jira-hook]` prefix
    - Ensure credentials/tokens are never included in log output
    - _Requirements: 8.4, 8.2, 8.3, 6.7_

  - [ ] 1.3 Implement Configuration Loader (`src/config.ts`)
    - Read from environment variables first (JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN)
    - Fall back to `.env` file only if env vars are missing
    - Validate `.env` is listed in `.gitignore` before reading; refuse and warn if not
    - Return structured error listing exactly which credentials are missing
    - Set default timeouts: mcpTimeout=10000, llmTimeout=30000
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

- [ ] 2. Implement ticket extraction and validation
  - [ ] 2.1 Implement Ticket ID Extractor (`src/ticket-extractor.ts`)
    - Apply regex `/\b[A-Z][A-Z0-9]+-\d+\b/g` to extract all matches
    - Deduplicate preserving first-occurrence order
    - Cap results at 5 IDs; log warning via Logger if more than 5 found
    - Return empty array if no matches
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [ ]* 2.2 Write property tests for ticket extraction
    - **Property 2: Ticket ID extraction produces deduplicated, order-preserving, capped results**
    - Generate messages with 1-10 ticket IDs, some duplicated, at varying positions
    - Verify deduplication, order preservation, and max-5 cap
    - **Validates: Requirements 2.1, 2.4**

  - [ ]* 2.3 Write unit tests for Ticket ID Extractor
    - Test single ID extraction, multiple IDs, duplicates, no IDs, boundary (exactly 5, more than 5)
    - Test IDs in subject vs body, IDs with various project prefixes
    - _Requirements: 2.1, 2.4_

- [ ] 3. Implement LLM summarization
  - [ ] 3.1 Implement LLM Summarizer (`src/llm-summarizer.ts`)
    - Accept `SummaryInput` (diff, commitMessage, changedFiles)
    - Single LLM call for small diffs via `askAgent` invocation
    - Map-reduce strategy for large diffs: summarize per-file, then combine
    - 30-second timeout; throw `TimeoutError` on expiry
    - Constrain prompt to produce 2-4 sentence plain-text summary using only info from diff/message
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [ ]* 3.2 Write property tests for LLM summarization
    - **Property 14: Large diff triggers map-reduce summarization**
    - Generate diffs of varying sizes around the context window threshold
    - Verify that diffs exceeding threshold invoke map phase then reduce phase
    - **Validates: Requirements 3.3**

  - [ ]* 3.3 Write property tests for LLM timeout fallback
    - **Property 10: LLM timeout fallback produces file list comment**
    - Generate random file path lists of varying lengths
    - Simulate timeout, verify fallback comment contains all filenames
    - **Validates: Requirements 7.4**

- [ ] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Implement Jira client
  - [ ] 5.1 Implement Jira Client (`src/jira-client.ts`)
    - Implement `postComment(ticketId, comment)` method
    - Implement `transitionTo(ticketId, statusName)` with transition lookup and case-insensitive name matching
    - MCP-first approach with 10s timeout; fall back to REST API v3 with HTTP Basic Auth on timeout/error
    - Retry logic: 1 retry with 2s backoff for 5xx/network errors; no retry for 401/403/404
    - Log per-ticket outcome (success, warning for 404/no-transition, error for auth failure)
    - _Requirements: 4.3, 4.4, 4.5, 4.6, 5.1, 5.3, 5.4, 6.5, 6.6, 7.1, 7.2, 7.3, 7.5, 7.6_

  - [ ]* 5.2 Write property tests for Jira Client retry behavior
    - **Property 9: Retryable errors trigger exactly one retry with backoff**
    - Generate 5xx status codes and network error types
    - Verify exactly one retry after ≥2s delay for retryable errors, zero retries for 401/403
    - **Validates: Requirements 7.2, 7.6**

  - [ ]* 5.3 Write property tests for transition name matching
    - **Property 4: Transition name matching is case-insensitive**
    - Generate transition lists with random-cased "In Review" variants
    - Verify case-insensitive matching selects first match in list order
    - **Validates: Requirements 4.3**

  - [ ]* 5.4 Write unit tests for Jira Client
    - Test MCP timeout triggers REST fallback
    - Test 404 logs warning and skips ticket
    - Test already "In Review" skips without warning
    - Test multiple matching transitions uses first
    - Test retry exhaustion logs failure and exits gracefully
    - _Requirements: 6.5, 6.6, 7.1, 7.2, 7.3, 7.6, 4.4, 4.5, 4.6_

- [ ] 6. Implement orchestrators
  - [ ] 6.1 Implement Post-Commit Orchestrator (`src/post-commit.ts`)
    - Load config (bail gracefully if missing credentials)
    - Get commit message via `git log -1 --format=%B <sha>`
    - Extract ticket IDs using Ticket ID Extractor
    - Get diff via `git show <sha> --no-color`
    - Generate LLM summary (fallback to file list on timeout/error)
    - Post comment to each ticket (up to 5)
    - Format comment: `🤖 Auto-summary from commit <short-sha>:\n<summary>`
    - Log per-ticket outcome; catch all unhandled exceptions and exit 0
    - _Requirements: 2.2, 3.1, 5.1, 5.2, 5.4, 7.4, 7.5, 8.1, 8.5_

  - [ ] 6.2 Implement Post-Push Orchestrator (`src/post-push.ts`)
    - Load config (bail gracefully if missing credentials)
    - Collect commits in push range via `git log <remote-sha>..<local-sha> --format=%B`
    - Extract and deduplicate all ticket IDs from all commit messages
    - Transition each ticket to "In Review" (skip if already there or transition unavailable)
    - Log per-ticket outcome; catch all unhandled exceptions and exit 0
    - _Requirements: 4.1, 4.2, 4.7, 7.5, 8.1, 8.5_

  - [ ]* 6.3 Write property tests for comment formatting
    - **Property 5: Comment formatting preserves structure**
    - Generate random 7-char hex strings and multi-line summary texts
    - Verify formatted output matches `🤖 Auto-summary from commit <short-sha>:\n<summary>` with no Markdown
    - **Validates: Requirements 5.2**

  - [ ]* 6.4 Write property tests for multi-commit ticket collection
    - **Property 3: Multi-commit ticket collection produces correct union**
    - Generate arrays of 1-20 commit messages with overlapping IDs
    - Verify collected set equals union of per-message extractions
    - **Validates: Requirements 4.2**

  - [ ]* 6.5 Write property tests for per-ticket logging
    - **Property 13: Per-ticket logging for multi-ticket commits**
    - Generate commit messages with 1-5 ticket IDs
    - Verify exactly K separate log messages produced, one per ticket
    - **Validates: Requirements 8.5**

- [ ] 7. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 8. Implement Git hooks and Kiro hook configuration
  - [ ] 8.1 Create commit-msg Git hook (`hooks/commit-msg`)
    - Write bash script that reads commit message from `$1`
    - Apply regex validation for Ticket_ID presence
    - On match: exit 0; On no match: print error to stderr with format example, exit 1
    - Handle merge commits (same validation applies)
    - Make script executable (chmod +x)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

  - [ ]* 8.2 Write property tests for commit message validation
    - **Property 1: Commit message validation is equivalent to regex match**
    - Generate arbitrary strings and strings with injected valid ticket IDs
    - Verify acceptance iff regex matches anywhere in the string
    - **Validates: Requirements 1.1, 1.3, 1.4, 1.5**

  - [ ] 8.3 Create pre-push Git hook (`hooks/pre-push`)
    - Write bash script that reads push refs from stdin
    - Parse local-ref, local-sha, remote-ref, remote-sha
    - Call the Post-Push Orchestrator TypeScript entry point with parsed arguments
    - Make script executable (chmod +x)
    - _Requirements: 4.1, 4.7_

  - [ ] 8.4 Create Kiro Agent Hook configuration for post-commit
    - Configure Kiro hook to trigger on post-commit event
    - Hook invokes the Post-Commit Orchestrator with the latest commit SHA
    - Ensure non-blocking execution (developer workflow not interrupted)
    - _Requirements: 5.1, 7.5_

- [ ] 9. Implement configuration and logging property tests
  - [ ]* 9.1 Write property tests for environment variable precedence
    - **Property 6: Environment variable precedence over .env file**
    - Generate random key-value pairs for both env and .env file sources
    - Verify env var value is always returned when both exist
    - **Validates: Requirements 6.2**

  - [ ]* 9.2 Write property tests for missing credential reporting
    - **Property 7: Missing credentials are reported accurately**
    - Generate random subsets of required keys as "present"
    - Verify error lists exactly the missing keys (no more, no fewer)
    - **Validates: Requirements 6.4**

  - [ ]* 9.3 Write property tests for credential leakage prevention
    - **Property 8: Credentials never appear in log output**
    - Generate random token strings, run operations, scan all output
    - Verify no log message contains the API token or substrings longer than 4 characters
    - **Validates: Requirements 6.7**

  - [ ]* 9.4 Write property tests for log prefix
    - **Property 11: All log messages carry the [jira-hook] prefix**
    - Invoke all log methods (info, warn, error) with random inputs
    - Verify every output line starts with `[jira-hook]`
    - **Validates: Requirements 8.4**

  - [ ]* 9.5 Write property tests for error log format
    - **Property 12: Non-success log messages include ticket ID, operation, and reason**
    - Generate random ticket IDs, operations, and error reasons
    - Verify warn/error output contains all three elements
    - **Validates: Requirements 8.2, 8.3**

- [ ] 10. Integration tests and final wiring
  - [ ]* 10.1 Write integration tests for post-commit flow
    - Test happy path: commit with ticket ID → LLM summary → Jira comment posted
    - Test MCP fallback: MCP times out → REST used successfully
    - Test LLM fallback: LLM times out → file list comment posted
    - Test multi-ticket: commit with 3 ticket IDs → all 3 get comments
    - Test missing credentials: all Jira operations skipped gracefully
    - _Requirements: 5.1, 5.2, 5.4, 6.4, 6.5, 6.6, 7.4_

  - [ ]* 10.2 Write integration tests for post-push flow
    - Test happy path: push with tickets → status transitioned to "In Review"
    - Test already "In Review": transition skipped silently
    - Test transition not available: warning logged, no error
    - Test credential validation: no credentials → operations skipped
    - _Requirements: 4.1, 4.2, 4.4, 4.5, 6.4_

  - [ ] 10.3 Create README.md with setup and usage instructions
    - Document installation steps (npm install, hook setup)
    - Document configuration (.env file, environment variables)
    - Document behavior (commit validation, auto-comments, status transitions)
    - Document error handling and troubleshooting
    - _Requirements: 6.1, 6.3_

- [ ] 11. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The design uses TypeScript throughout; all implementation code uses TypeScript with Node.js
- Git hook scripts (commit-msg, pre-push) are bash for zero-dependency execution speed
- Integration tests use mocked external services (Jira API, MCP server, LLM)

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["2.1", "3.1"] },
    { "id": 3, "tasks": ["2.2", "2.3", "3.2", "3.3", "5.1"] },
    { "id": 4, "tasks": ["5.2", "5.3", "5.4", "8.1"] },
    { "id": 5, "tasks": ["6.1", "6.2", "8.2", "8.3"] },
    { "id": 6, "tasks": ["6.3", "6.4", "6.5", "8.4", "9.1", "9.2", "9.3", "9.4", "9.5"] },
    { "id": 7, "tasks": ["10.1", "10.2", "10.3"] }
  ]
}
```
