import { execSync } from "node:child_process";
import axios from "axios";

export interface SummaryInput {
  diff: string;
  commitMessage: string;
  changedFiles: string[];
}

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MAX_DIFF_CHARS = 12_000; // Keep under Groq token limits

/**
 * Generates a concise, specific summary of a commit using Groq LLM.
 * Describes exactly what changed in plain English.
 */
export async function generateSummary(
  input: SummaryInput,
  timeoutMs: number = 30_000
): Promise<string> {
  const apiKey = process.env.LLM_API_KEY;

  if (!apiKey) {
    return buildFileListFallback(input.changedFiles);
  }

  try {
    // Truncate diff if too large
    let diff = input.diff;
    if (diff.length > MAX_DIFF_CHARS) {
      diff = diff.slice(0, MAX_DIFF_CHARS) + "\n... (diff truncated)";
    }

    const prompt = `You are a commit summarizer. Given a git diff and commit message, write a 2-3 sentence summary describing EXACTLY what was changed in plain English. Be specific — mention actual variable names, function names, text changes, values, etc. Do not be vague or generic.

Examples of GOOD summaries:
- "Removed the colon after the ticket ID in the commit message format. Updated the error message text from 'invalid' to 'not found'."
- "Changed the background color from #f5f5f5 to #ffffff in the body style. Added a new Benefits section with four bullet points to the landing page."
- "Added retry logic with 2-second backoff to the Jira API client. The postComment method now catches 5xx errors and retries once before failing."

Examples of BAD summaries (too vague — never write like this):
- "Modified files and updated code."
- "Changes include new function definitions or logic updates."
- "Updated the project with various improvements."

Commit message: ${input.commitMessage}
Changed files: ${input.changedFiles.join(", ")}

Diff:
${diff}

Write your 2-3 sentence summary. Be specific about what exactly changed:`;

    const response = await axios.post(
      GROQ_URL,
      {
        model: "llama-3.1-8b-instant",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
        max_tokens: 200,
      },
      {
        timeout: timeoutMs,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
      }
    );

    const text = response.data?.choices?.[0]?.message?.content;
    if (text) {
      return text.trim();
    }

    return buildFileListFallback(input.changedFiles);
  } catch (error) {
    // Fallback on any LLM failure
    return buildFileListFallback(input.changedFiles);
  }
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
