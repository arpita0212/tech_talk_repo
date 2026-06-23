import { execSync } from "node:child_process";
import { loadConfig } from "./config.js";
import { logger } from "./logger.js";
import { extractTicketIds } from "./ticket-extractor.js";
import { JiraClient } from "./jira-client.js";

const TARGET_STATUS = "In Review";

/**
 * Post-push orchestrator.
 * Runs after a successful push: collects all ticket IDs from the pushed commits
 * and transitions each ticket to "In Review".
 *
 * This is where status transitions happen — not on commit.
 */
export async function runPostPush(
  localSha: string,
  remoteSha: string
): Promise<void> {
  try {
    // Load config
    const configResult = loadConfig();
    if (!configResult.ok) {
      logger.systemError(
        `Missing Jira credentials: ${configResult.error.missingFields.join(", ")}. Skipping Jira operations.`
      );
      return;
    }

    // Collect all commit messages in the push range
    // If remoteSha is all zeros (new branch), get all commits on this branch
    let commitMessages: string;
    if (remoteSha === "0000000000000000000000000000000000000000") {
      // New branch — get commits not on main/master
      try {
        commitMessages = execSync(
          `git log origin/main..${localSha} --format=%B`,
          { encoding: "utf-8" }
        );
      } catch {
        commitMessages = execSync(
          `git log origin/master..${localSha} --format=%B`,
          { encoding: "utf-8" }
        );
      }
    } else {
      commitMessages = execSync(
        `git log ${remoteSha}..${localSha} --format=%B`,
        { encoding: "utf-8" }
      );
    }

    // Extract and deduplicate all ticket IDs across all commits
    const allTicketIds = extractTicketIds(commitMessages);
    if (allTicketIds.length === 0) {
      logger.system("No ticket IDs found in pushed commits. Skipping status transition.");
      return;
    }

    logger.system(
      `Transitioning ${allTicketIds.length} ticket(s) to "${TARGET_STATUS}": ${allTicketIds.join(", ")}`
    );

    // Transition each ticket
    const jira = new JiraClient(configResult.config);
    for (const ticketId of allTicketIds) {
      await jira.transitionTo(ticketId, TARGET_STATUS);
    }
  } catch (error) {
    // Never crash the hook or block the push
    logger.systemError(
      `Post-push hook failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

// Allow running directly (called from pre-push bash hook)
const isMainModule = process.argv[1]?.includes("post-push");
if (isMainModule) {
  const localSha = process.argv[2] || "";
  const remoteSha = process.argv[3] || "";
  runPostPush(localSha, remoteSha).then(() => process.exit(0));
}
