# Jira Auto-Update Hook

Automatically keeps Jira tickets in sync with your commits and pushes. No manual ticket updates required.

## What It Does

| Event | Action |
|-------|--------|
| `git commit` | Validates ticket ID in message (blocks if missing) → posts LLM-generated summary as Jira comment |
| `git push` | Transitions all referenced tickets to "In Review" |

## Setup

### 1. Install dependencies

```bash
npm install
npm run build
```

### 2. Configure Jira credentials

Copy the example env file and fill in your values:

```bash
cp .env.example .env
```

Edit `.env`:
```
JIRA_BASE_URL=https://your-domain.atlassian.net
JIRA_EMAIL=your-email@example.com
JIRA_API_TOKEN=your-api-token-here
```

To get an API token: [Atlassian API Token](https://id.atlassian.com/manage-profile/security/api-tokens)

Alternatively, set these as environment variables directly (they take precedence over `.env`).

### 3. Install Git hooks

```bash
npm run setup-hooks
```

This copies `hooks/commit-msg` and `hooks/pre-push` into `.git/hooks/`.

## Commit Message Format

Every commit message must contain a Jira ticket ID:

```
PROJ-123: Add retry logic to payment webhook
```

The ticket ID can appear anywhere in the message (subject or body). Pattern: uppercase letters + hyphen + digits (e.g., `PROJ-123`, `ABC-42`, `TEAM2-999`).

### What happens if you forget?

```
❌ Commit rejected: no Jira ticket ID found in commit message.

   Include a ticket key (e.g. PROJ-123) in your commit message and try again.
   Example: PROJ-123: Add retry logic to payment webhook
```

## How It Works

1. **commit-msg hook** (bash) — Validates ticket ID with regex. Blocks commit if missing.
2. **Post-commit** (TypeScript) — Extracts ticket IDs, generates LLM summary of the diff, posts comment to Jira.
3. **pre-push hook** (bash → TypeScript) — Collects all ticket IDs from pushed commits, transitions each to "In Review".

## Multiple Tickets

If your commit message contains multiple ticket IDs (up to 5), all of them get updated:

```
PROJ-123 PROJ-456: Refactor shared auth module
```

## Error Handling

- Jira API failures never block your commit or push
- Network errors get one retry with 2-second backoff
- LLM failures fall back to posting just the changed file list
- Auth errors (401/403) are logged clearly without retry

## Testing

```bash
npm test
```

## Project Structure

```
├── hooks/
│   ├── commit-msg        # Git hook: validates ticket ID
│   └── pre-push          # Git hook: triggers status transition
├── src/
│   ├── config.ts         # Configuration loader (.env + env vars)
│   ├── jira-client.ts    # Jira API client (REST with retry)
│   ├── llm-summarizer.ts # LLM diff summarization
│   ├── logger.ts         # Structured logging ([jira-hook] prefix)
│   ├── post-commit.ts    # Post-commit orchestrator
│   ├── post-push.ts      # Post-push orchestrator
│   └── ticket-extractor.ts # Ticket ID regex extraction
├── scripts/
│   └── setup-hooks.js    # Installs hooks to .git/hooks/
├── .env.example          # Template for Jira credentials
└── .gitignore            # Excludes .env, node_modules, dist
```
