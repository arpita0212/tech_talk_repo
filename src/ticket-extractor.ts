import { logger } from "./logger.js";

const TICKET_ID_REGEX = /\b[A-Z][A-Z0-9]+-\d+\b/g;
const MAX_TICKETS = 5;

/**
 * Extracts unique Jira ticket IDs from a commit message.
 * Returns deduplicated list in order of first appearance, capped at 5.
 */
export function extractTicketIds(commitMessage: string): string[] {
  const matches = commitMessage.match(TICKET_ID_REGEX);
  if (!matches || matches.length === 0) {
    return [];
  }

  // Deduplicate preserving first-occurrence order
  const unique = [...new Set(matches)];

  if (unique.length > MAX_TICKETS) {
    logger.warn(
      unique[0],
      `Found ${unique.length} ticket IDs in commit message, processing only the first ${MAX_TICKETS}. Ignored: ${unique.slice(MAX_TICKETS).join(", ")}`
    );
    return unique.slice(0, MAX_TICKETS);
  }

  if (unique.length > 1) {
    logger.system(`Multiple ticket IDs detected: ${unique.join(", ")}`);
  }

  return unique;
}
