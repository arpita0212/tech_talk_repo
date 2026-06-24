import { execSync } from "node:child_process";

export interface SummaryInput {
  diff: string;
  commitMessage: string;
  changedFiles: string[];
}

// Approximate token limit for a single LLM call (characters)
const CONTEXT_WINDOW_CHARS = 80_000;

/**
 * Generates a 2-4 sentence summary of a commit diff.
 * Uses diff analysis to produce a meaningful summary describing what changed.
 */
export async function generateSummary(
  input: SummaryInput,
  timeoutMs: number = 30_000
): Promise<string> {
  try {
    return buildDiffSummary(input);
  } catch {
    return buildFileListFallback(input.changedFiles);
  }
}

/**
 * Analyzes the diff to produce a human-readable summary.
 */
function buildDiffSummary(input: SummaryInput): string {
  const { diff, commitMessage, changedFiles } = input;

  // Parse the diff to extract meaningful changes
  const additions: string[] = [];
  const deletions: string[] = [];
  const modifications: string[] = [];

  const lines = diff.split("\n");
  let currentFile = "";

  for (const line of lines) {
    // Track current file
    const fileMatch = line.match(/^diff --git a\/(.+?) b\//);
    if (fileMatch) {
      currentFile = fileMatch[1];
      continue;
    }

    // Track added/removed lines (skip diff metadata)
    if (line.startsWith("+") && !line.startsWith("+++")) {
      const content = line.slice(1).trim();
      if (content.length > 3) additions.push(content);
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      const content = line.slice(1).trim();
      if (content.length > 3) deletions.push(content);
    }
  }

  // Determine change type
  const isNewFiles = deletions.length === 0 && additions.length > 0;
  const isDeleted = additions.length === 0 && deletions.length > 0;
  const isModified = additions.length > 0 && deletions.length > 0;

  // Build summary parts
  const parts: string[] = [];

  // What files were affected
  if (changedFiles.length === 1) {
    parts.push(`Modified ${changedFiles[0]}.`);
  } else if (changedFiles.length <= 3) {
    parts.push(`Modified ${changedFiles.join(", ")}.`);
  } else {
    parts.push(`Modified ${changedFiles.length} files including ${changedFiles.slice(0, 2).join(", ")}.`);
  }

  // What kind of changes
  if (isNewFiles) {
    parts.push(`Added ${additions.length} new lines of code.`);
  } else if (isDeleted) {
    parts.push(`Removed ${deletions.length} lines of code.`);
  } else if (isModified) {
    parts.push(`${additions.length} lines added, ${deletions.length} lines removed.`);
  }

  // Detect meaningful patterns in the changes
  const significantAdditions = additions
    .filter((a) => a.length > 10 && !a.startsWith("//") && !a.startsWith("*") && !a.startsWith("import"))
    .slice(0, 5);

  if (significantAdditions.length > 0) {
    // Try to identify what was added (functions, classes, HTML elements, etc.)
    const functionAdds = significantAdditions.filter(
      (a) => a.includes("function") || a.includes("=>") || a.includes("async") || a.includes("export")
    );
    const htmlAdds = significantAdditions.filter(
      (a) => a.startsWith("<") || a.includes("class=") || a.includes("id=")
    );
    const configAdds = significantAdditions.filter(
      (a) => a.includes(":") && (a.includes('"') || a.includes("'"))
    );

    if (functionAdds.length > 0) {
      parts.push("Changes include new function definitions or logic updates.");
    } else if (htmlAdds.length > 0) {
      parts.push("Changes include HTML/markup structure updates.");
    } else if (configAdds.length > 0) {
      parts.push("Changes include configuration or property updates.");
    } else {
      // Describe based on file extension
      const extensions = changedFiles.map((f) => f.split(".").pop()).filter(Boolean);
      const uniqueExts = [...new Set(extensions)];
      if (uniqueExts.includes("ts") || uniqueExts.includes("js")) {
        parts.push("Changes include TypeScript/JavaScript code updates.");
      } else if (uniqueExts.includes("html") || uniqueExts.includes("css")) {
        parts.push("Changes include frontend markup or styling updates.");
      }
    }
  }

  // Check for test files
  const testFiles = changedFiles.filter(
    (f) => f.includes("test") || f.includes("spec") || f.includes("__tests__")
  );
  if (testFiles.length > 0) {
    parts.push("Tests were added or modified.");
  }

  return parts.join(" ");
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
