import { execSync } from "node:child_process";
import { loadConfig } from "./config.js";
import { logger } from "./logger.js";
import { extractTicketIds } from "./ticket-extractor.js";

/**
 * Post-commit orchestrator.
 * Runs after a successful commit. Currently only logs which tickets were detected.
 * The actual Jira comment + status transition happens on push (see post-push.ts).
 */
export async function runPostCommit(commitSha?: string): Promise<void> {
  try {
    const sha =
      commitSha ||
      execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();

    // Get commit message
    const commitMessage = execSync(`git log -1 --format=%B ${sha}`, {
      encoding: "utf-8",
    }).trim();

    // Extract ticket IDs (just for logging)
    const ticketIds = extractTicketIds(commitMessage);
    if (ticketIds.length > 0) {
      logger.system(
        `Commit references: ${ticketIds.join(", ")}. Jira will be updated on push.`
      );
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
