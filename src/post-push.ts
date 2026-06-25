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

/** Prefixes that control status transitions */
const SKIP_PREFIXES = ["[wip]", "[no-review]", "[skip-review]"];
const IN_PROGRESS_PREFIXES = ["[in-progress]", "[ip]", "[start]"];

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

    // Post a comment for EACH commit
    for (const sha of commitShas) {
      const shortSha = sha.slice(0, 7);
      const commitMessage = execSync(`git log -1 --format=%B ${sha}`, { encoding: "utf-8" }).trim();

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

    // Determine target status based on prefixes
    const lowerAllMessages = commitShas.length > 0 ? "" : ""; // will check per-commit
    let hasSkipPrefix = false;
    let hasInProgressPrefix = false;

    for (const sha of commitShas) {
      const msg = execSync(`git log -1 --format=%B ${sha}`, { encoding: "utf-8" }).trim().toLowerCase();
      if (SKIP_PREFIXES.some((p) => msg.includes(p))) hasSkipPrefix = true;
      if (IN_PROGRESS_PREFIXES.some((p) => msg.includes(p))) hasInProgressPrefix = true;
    }

    // Determine final status
    let targetStatus: string | null = null;
    if (hasSkipPrefix) {
      targetStatus = null; // No transition
    } else if (hasInProgressPrefix) {
      targetStatus = "In Progress";
    } else {
      targetStatus = "Review";
    }

    // Transition tickets
    if (targetStatus && allTicketIds.size > 0) {
      logger.system(
        `Transitioning ${allTicketIds.size} ticket(s) to "${targetStatus}": ${[...allTicketIds].join(", ")}`
      );
      for (const ticketId of allTicketIds) {
        await jira.transitionTo(ticketId, targetStatus);
      }
    } else if (hasSkipPrefix) {
      logger.system(
        "Skip prefix detected. Comments posted but skipping status transition."
      );
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
