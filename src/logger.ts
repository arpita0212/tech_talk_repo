const PREFIX = "[jira-hook]";

export const logger = {
  info(ticketId: string, message: string): void {
    process.stdout.write(`${PREFIX} ✅ ${ticketId}: ${message}\n`);
  },

  warn(ticketId: string, message: string): void {
    process.stderr.write(`${PREFIX} ⚠️  ${ticketId}: ${message}\n`);
  },

  error(ticketId: string, message: string): void {
    process.stderr.write(`${PREFIX} ❌ ${ticketId}: ${message}\n`);
  },

  /** For messages not tied to a specific ticket */
  system(message: string): void {
    process.stdout.write(`${PREFIX} ${message}\n`);
  },

  systemError(message: string): void {
    process.stderr.write(`${PREFIX} ❌ ${message}\n`);
  },
};
