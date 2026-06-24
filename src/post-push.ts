import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
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

const TARGET_STATUS = "Review";

/** Prefixes that skip the status transition (case-insensitive) */
const SKIP_PREFIXES = ["[wip]", "[no-review]", "[skip-review]"];

/**
 * Post-push orchestrator.
 * Runs after a successful push:
 * - Posts a separate summary comment for EACH commit in the push
 * - Transitions tickets to "Review" (unless a skip prefix is present)
 */
export async function runPostPush(
  localSha: string,
  remoteSha: string
): Promise<void> {
  try {
    // Load .env file for credentials and LLM key
    const projectRoot = execSync("git rev-parse --show-toplevel", { encoding: "utf-8" }).trim();
    loadDotenv({ path: resolve(projectRoot, ".env") });
    // Load config
    const configResult = loadConfig();
    if (!configResult.ok) {
      logger.systemError(
        `Missing Jira credentials: ${configResult.error.missingFields.join(", ")}. Skipping Jira operations.`
      );
      return;
    }

    // Get list of commit SHAs in the push range
    let commitRange: string;
    if (remoteSha === "0000000000000000000000000000000000000000") {
      try {
        commitRange = `origin/main..${localSha}`;
        execSync(`git log ${commitRange} --format=%H`, { encoding: "utf-8" });
      } catch {
        commitRange = `origin/master..${localSha}`;
      }
    } else {
      commitRange = `${remoteSha}..${localSha}`;
    }

    const commitShas = execSync(`git log ${commitRange} --format=%H`, { encoding: "utf-8" })
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    if (commitShas.length === 0) {
      logger.system("No commits found in push range. Skipping.");
      return;
    }

    const jira = new JiraClient(configResult.config);
    const allTicketIds = new Set<string>();
    let hasSkipPrefix = false;

    // Post a comment for EACH commit
    for (const sha of commitShas) {
      const shortSha = sha.slice(0, 7);
      const commitMessage = execSync(`git log -1 --format=%B ${sha}`, { encoding: "utf-8" }).trim();

      // Check for skip prefix in this commit
      const lowerMsg = commitMessage.toLowerCase();
      if (SKIP_PREFIXES.some((p) => lowerMsg.includes(p))) {
        hasSkipPrefix = true;
      }

      // Extract ticket IDs from this commit
      const ticketIds = extractTicketIds(commitMessage);
      if (ticketIds.length === 0) continue;

      ticketIds.forEach((id) => allTicketIds.add(id));

      // Generate summary for THIS commit's diff
      const diff = getCommitDiff(sha);
      const changedFiles = getChangedFiles(sha);

      let summary: string;
      try {
        summary = await generateSummary(
          { diff, commitMessage, changedFiles },
          configResult.config.llmTimeout
        );
      } catch {
        summary = buildFileListFallback(changedFiles);
      }

      const comment = `Auto-summary from commit ${shortSha}:\n${summary}`;

      // Post comment to each ticket referenced in this commit
      for (const ticketId of ticketIds) {
        await jira.postComment(ticketId, comment);
      }
    }

    // Transition tickets to Review (unless skip prefix was found)
    if (hasSkipPrefix) {
      logger.system(
        "Skip prefix detected. Comments posted but skipping status transition."
      );
      return;
    }

    if (allTicketIds.size > 0) {
      logger.system(
        `Transitioning ${allTicketIds.size} ticket(s) to "${TARGET_STATUS}": ${[...allTicketIds].join(", ")}`
      );
      for (const ticketId of allTicketIds) {
        await jira.transitionTo(ticketId, TARGET_STATUS);
      }
    }
  } catch (error) {
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
