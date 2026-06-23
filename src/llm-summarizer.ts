import { execSync } from "node:child_process";

export interface SummaryInput {
  diff: string;
  commitMessage: string;
  changedFiles: string[];
}

// Approximate token limit for a single LLM call (characters, not tokens — conservative estimate)
const CONTEXT_WINDOW_CHARS = 80_000;

/**
 * Generates a 2-4 sentence summary of a commit diff using LLM.
 * Falls back to a file list if the LLM is unavailable.
 */
export async function generateSummary(
  input: SummaryInput,
  timeoutMs: number = 30_000
): Promise<string> {
  try {
    if (input.diff.length > CONTEXT_WINDOW_CHARS) {
      return await mapReduceSummary(input, timeoutMs);
    }
    return await singleSummary(input, timeoutMs);
  } catch (error) {
    // Fallback to file list on any failure
    return buildFileListFallback(input.changedFiles);
  }
}

async function singleSummary(
  input: SummaryInput,
  timeoutMs: number
): Promise<string> {
  const prompt = buildPrompt(input.diff, input.commitMessage, input.changedFiles);
  return await callLLM(prompt, timeoutMs);
}

async function mapReduceSummary(
  input: SummaryInput,
  timeoutMs: number
): Promise<string> {
  // Split diff by file
  const fileDiffs = splitDiffByFile(input.diff);
  const perFileTimeoutMs = Math.floor(timeoutMs / (fileDiffs.length + 1));

  // Map: summarize each file
  const fileSummaries: string[] = [];
  for (const fileDiff of fileDiffs) {
    try {
      const prompt = buildFilePrompt(fileDiff.filename, fileDiff.diff);
      const summary = await callLLM(prompt, perFileTimeoutMs);
      fileSummaries.push(`${fileDiff.filename}: ${summary}`);
    } catch {
      fileSummaries.push(`${fileDiff.filename}: changes made`);
    }
  }

  // Reduce: combine file summaries into a final 2-4 sentence summary
  const reducePrompt = buildReducePrompt(fileSummaries, input.commitMessage);
  return await callLLM(reducePrompt, perFileTimeoutMs);
}

function buildPrompt(
  diff: string,
  commitMessage: string,
  changedFiles: string[]
): string {
  return `You are summarizing a git commit. Produce a plain-text summary of 2-4 sentences.
Cover: (1) what changed (behavior/functions, not just filenames), (2) why it changed if stated in the commit message, (3) whether tests were added or modified.
Do NOT speculate or add information not present in the diff or commit message.

Commit message: ${commitMessage}

Changed files: ${changedFiles.join(", ")}

Diff:
${diff}

Summary:`;
}

function buildFilePrompt(filename: string, diff: string): string {
  return `Summarize the changes to ${filename} in 1-2 sentences. Only describe what is directly visible in the diff.

Diff:
${diff}

Summary:`;
}

function buildReducePrompt(fileSummaries: string[], commitMessage: string): string {
  return `You are combining per-file summaries into a single commit summary of 2-4 sentences.
Cover: (1) what changed overall, (2) why if stated in the commit message, (3) whether tests were modified.
Do NOT add information not present in the summaries or commit message.

Commit message: ${commitMessage}

Per-file summaries:
${fileSummaries.join("\n")}

Combined summary:`;
}

function splitDiffByFile(diff: string): Array<{ filename: string; diff: string }> {
  const fileDiffs: Array<{ filename: string; diff: string }> = [];
  const sections = diff.split(/^diff --git /m);

  for (const section of sections) {
    if (!section.trim()) continue;
    const lines = section.split("\n");
    const headerMatch = lines[0]?.match(/a\/(.+?) b\//);
    const filename = headerMatch ? headerMatch[1] : "unknown";
    fileDiffs.push({ filename, diff: section });
  }

  return fileDiffs;
}

/**
 * Calls the LLM. In the Kiro Agent Hook context, this will be handled by
 * the agent's askAgent mechanism. For standalone use, this is a placeholder
 * that can be wired to any LLM API.
 */
async function callLLM(prompt: string, timeoutMs: number): Promise<string> {
  // This function is designed to be called within a Kiro Agent Hook context
  // where the agent itself handles LLM calls. For standalone/testing purposes,
  // we throw to trigger the fallback.
  throw new Error("LLM_NOT_AVAILABLE: Must be called within Kiro Agent Hook context");
}

export function buildFileListFallback(changedFiles: string[]): string {
  return `Changed files: ${changedFiles.join(", ")}`;
}

/** Get the diff for a specific commit */
export function getCommitDiff(sha: string): string {
  return execSync(`git show ${sha} --no-color`, { encoding: "utf-8" });
}

/** Get the list of changed files for a commit */
export function getChangedFiles(sha: string): string[] {
  const output = execSync(`git show ${sha} --name-only --format=""`, {
    encoding: "utf-8",
  });
  return output
    .split("\n")
    .map((f) => f.trim())
    .filter((f) => f.length > 0);
}
