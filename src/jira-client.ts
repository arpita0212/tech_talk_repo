import axios, { AxiosError, type AxiosInstance } from "axios";
import { logger } from "./logger.js";
import type { JiraConfig } from "./config.js";

const RETRY_BACKOFF_MS = 2000;
const RETRYABLE_STATUSES = [500, 502, 503, 504];
const RETRYABLE_ERRORS = ["ECONNREFUSED", "ETIMEDOUT", "ECONNRESET", "EAI_AGAIN"];

interface JiraTransition {
  id: string;
  name: string;
  to: { name: string; id: string };
}

export class JiraClient {
  private client: AxiosInstance;

  constructor(private config: JiraConfig) {
    this.client = axios.create({
      baseURL: `${config.baseUrl}/rest/api/3`,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      auth: {
        username: config.email,
        password: config.apiToken,
      },
      timeout: 15_000,
    });
  }

  /**
   * Post a comment to a Jira ticket.
   */
  async postComment(ticketId: string, comment: string): Promise<boolean> {
    const body = {
      body: {
        type: "doc",
        version: 1,
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: comment }],
          },
        ],
      },
    };

    try {
      await this.requestWithRetry(
        "POST",
        `/issue/${ticketId}/comment`,
        body,
        ticketId
      );
      logger.info(ticketId, "Comment posted successfully");
      return true;
    } catch (error) {
      return this.handleError(ticketId, "postComment", error);
    }
  }

  /**
   * Transition a Jira ticket to "In Review" status.
   */
  async transitionTo(ticketId: string, statusName: string): Promise<boolean> {
    try {
      // Look up available transitions
      const response = await this.requestWithRetry(
        "GET",
        `/issue/${ticketId}/transitions`,
        undefined,
        ticketId
      );

      const transitions: JiraTransition[] = response.data.transitions || [];

      // Check if already in target status (no transition needed)
      const issueResponse = await this.requestWithRetry(
        "GET",
        `/issue/${ticketId}?fields=status`,
        undefined,
        ticketId
      );
      const currentStatus: string =
        issueResponse.data.fields?.status?.name || "";

      if (currentStatus.toLowerCase() === statusName.toLowerCase()) {
        // Already in target status — skip silently
        return true;
      }

      // Find matching transition (case-insensitive)
      const matchingTransition = transitions.find(
        (t) => t.to.name.toLowerCase() === statusName.toLowerCase()
      );

      if (!matchingTransition) {
        logger.warn(
          ticketId,
          `Transition to "${statusName}" not available from current status "${currentStatus}". Available transitions: ${transitions.map((t) => t.to.name).join(", ")}`
        );
        return false;
      }

      // Execute the transition
      await this.requestWithRetry(
        "POST",
        `/issue/${ticketId}/transitions`,
        { transition: { id: matchingTransition.id } },
        ticketId
      );

      logger.info(ticketId, `Status transitioned to "${statusName}"`);
      return true;
    } catch (error) {
      return this.handleError(ticketId, "transitionTo", error);
    }
  }

  private async requestWithRetry(
    method: "GET" | "POST",
    url: string,
    data: unknown,
    ticketId: string
  ): Promise<any> {
    try {
      return await this.makeRequest(method, url, data);
    } catch (error) {
      if (this.isRetryable(error)) {
        // Wait and retry once
        await this.sleep(RETRY_BACKOFF_MS);
        return await this.makeRequest(method, url, data);
      }
      throw error;
    }
  }

  private async makeRequest(
    method: "GET" | "POST",
    url: string,
    data: unknown
  ): Promise<any> {
    if (method === "GET") {
      return await this.client.get(url);
    }
    return await this.client.post(url, data);
  }

  private isRetryable(error: unknown): boolean {
    if (error instanceof AxiosError) {
      // Don't retry auth errors or 404
      if (error.response?.status === 401 || error.response?.status === 403) {
        return false;
      }
      if (error.response?.status === 404) {
        return false;
      }
      // Retry 5xx
      if (
        error.response?.status &&
        RETRYABLE_STATUSES.includes(error.response.status)
      ) {
        return true;
      }
      // Retry network errors
      if (error.code && RETRYABLE_ERRORS.includes(error.code)) {
        return true;
      }
    }
    return false;
  }

  private handleError(
    ticketId: string,
    operation: string,
    error: unknown
  ): false {
    if (error instanceof AxiosError) {
      const status = error.response?.status;
      if (status === 404) {
        logger.warn(
          ticketId,
          `${operation}: Ticket not found in Jira (404). It may have been deleted or the ID is incorrect.`
        );
      } else if (status === 401 || status === 403) {
        logger.error(
          ticketId,
          `${operation}: Authentication failed (${status}). Check your JIRA_API_TOKEN and JIRA_EMAIL.`
        );
      } else {
        logger.error(
          ticketId,
          `${operation}: Jira API error (${status || error.code || "unknown"}). ${error.message}`
        );
      }
    } else {
      logger.error(
        ticketId,
        `${operation}: Unexpected error — ${error instanceof Error ? error.message : String(error)}`
      );
    }
    return false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
