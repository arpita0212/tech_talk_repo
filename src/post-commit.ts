import { execSync } from "node:child_process";
import { loadConfig } from "./config.js";
import { logger } from "./logger.js";
import { extractTicketIds } from "./ticket-extractor.js";
import { JiraClient } from "./jira-client.js";
import {
  generateSummary,
  getCommitDiff,
  getChangedFiles,
  buildFileListFallback,
} from "./llm-summarizer.js";

/**
 * Post-commit orchestrator.
 * Runs after a successful commit: extracts ticket IDs, generates a diff summary,
 * and posts it as a comment to each referenced Jira ticket.
 *
 * This does NOT transition status — that happens on push.
 */
export async function runPostCommit(commitSha?: string): Promise<void> {
  try {
    // Get the latest commit SHA if not provided
    const sha =
      commitSha ||
      execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
    const shortSha = sha.slice(0, 7);

    // Load config
    const configResult = loadConfig();
    if (!configResult.ok) {
      logger.systemError(
        `Missing Jira credentials: ${configResult.error.missingFields.join(", ")}. Skipping Jira operations.`
      );
      return;
    }

    // Get commit message
    const commitMessage = execSync(`git log -1 --format=%B ${sha}`, {
      encoding: "utf-8",
    }).trim();

    // Extract ticket IDs
    const ticketIds = extractTicketIds(commitMessage);
    if (ticketIds.length === 0) {
      // This shouldn't happen if commit-msg hook is active, but handle gracefully
      logger.system("No ticket IDs found in commit message. Skipping Jira update.");
      return;
    }

    // Get diff and changed files
    const diff = getCommitDiff(sha);
    const changedFiles = getChangedFiles(sha);

    // Generate LLM summary (with fallback)
    let summary: string;
    try {
      summary = await generateSummary(
        { diff, commitMessage, changedFiles },
        configResult.config.llmTimeout
      );
    } catch {
      summary = buildFileListFallback(changedFiles);
    }

    // Format the comment
    const comment = `🤖 Auto-summary from commit ${shortSha}:\n${summary}`;

    // Post comment to each ticket
    const jira = new JiraClient(configResult.config);
    for (const ticketId of ticketIds) {
      await jira.postComment(ticketId, comment);
    }
  } catch (error) {
    // Never crash the hook
    logger.systemError(
      `Post-commit hook failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

// Allow running directly
const isMainModule = process.argv[1]?.includes("post-commit");
if (isMainModule) {
  const sha = process.argv[2];
  runPostCommit(sha).then(() => process.exit(0));
}
