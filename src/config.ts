import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { logger } from "./logger.js";

export interface JiraConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
  mcpTimeout: number;
  llmTimeout: number;
}

export interface ConfigError {
  missingFields: string[];
  envFileNotGitignored?: boolean;
}

export type ConfigResult =
  | { ok: true; config: JiraConfig }
  | { ok: false; error: ConfigError };

const REQUIRED_KEYS = ["JIRA_BASE_URL", "JIRA_EMAIL", "JIRA_API_TOKEN"] as const;

function isEnvFileGitignored(projectRoot: string): boolean {
  const gitignorePath = resolve(projectRoot, ".gitignore");
  if (!existsSync(gitignorePath)) return false;

  const content = readFileSync(gitignorePath, "utf-8");
  return content.split("\n").some((line) => {
    const trimmed = line.trim();
    return trimmed === ".env" || trimmed === ".env*";
  });
}

function parseEnvFile(filePath: string): Record<string, string> {
  if (!existsSync(filePath)) return {};

  const content = readFileSync(filePath, "utf-8");
  const vars: Record<string, string> = {};

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    vars[key] = value;
  }

  return vars;
}

export function loadConfig(projectRoot: string = process.cwd()): ConfigResult {
  const envFilePath = resolve(projectRoot, ".env");
  let envFileVars: Record<string, string> = {};

  // Check .env file availability
  if (existsSync(envFilePath)) {
    if (!isEnvFileGitignored(projectRoot)) {
      logger.systemError(
        "Configuration: .env file exists but is NOT listed in .gitignore. Refusing to read credentials from it."
      );
      // Still try env vars
    } else {
      envFileVars = parseEnvFile(envFilePath);
    }
  }

  // Env vars take precedence over .env file
  const getValue = (key: string): string | undefined => {
    return process.env[key] || envFileVars[key] || undefined;
  };

  const baseUrl = getValue("JIRA_BASE_URL");
  const email = getValue("JIRA_EMAIL");
  const apiToken = getValue("JIRA_API_TOKEN");

  const missingFields: string[] = [];
  if (!baseUrl) missingFields.push("JIRA_BASE_URL");
  if (!email) missingFields.push("JIRA_EMAIL");
  if (!apiToken) missingFields.push("JIRA_API_TOKEN");

  if (missingFields.length > 0) {
    return {
      ok: false,
      error: { missingFields },
    };
  }

  return {
    ok: true,
    config: {
      baseUrl: baseUrl!,
      email: email!,
      apiToken: apiToken!,
      mcpTimeout: 10_000,
      llmTimeout: 30_000,
    },
  };
}
