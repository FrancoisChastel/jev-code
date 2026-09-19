import type { z } from "zod";
import type { JevClient, RequestOptions } from "../core/client.js";
import { JevValidationError } from "../core/errors.js";

export type ToolName = "jev_classify" | "jev_check" | "jev_score" | "jev_rank" | "jev_ask";

/**
 * One tool, described once and reused by every harness adapter:
 * the MCP server, the Pi extension, the OpenCode custom tool, and the CLI.
 */
export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  name: ToolName;
  /** Short human label, e.g. for Pi's tool list. */
  title: string;
  /** Full description shown to the model. */
  description: string;
  /** One-line summary for compact tool lists. */
  promptSnippet: string;
  /** Guidance bullets that name the tool explicitly (Pi appends them flat). */
  guidelines: readonly string[];
  /** zod object schema; the raw shape is available as `schema.shape` for MCP. */
  schema: z.ZodObject<z.ZodRawShape>;
  run(client: JevClient, input: TInput, options?: RequestOptions): Promise<TOutput>;
}

/** Parse unknown input with the tool's schema, surfacing a readable validation error. */
export function parseInput<T>(schema: z.ZodType<T>, input: unknown, toolName: string): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const issues = result.error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.length ? issue.path.join(".") : "(root)"}: ${issue.message}`)
    .join("; ");
  throw new JevValidationError(`Invalid input for ${toolName}: ${issues}`);
}
