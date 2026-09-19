/**
 * OpenCode custom tool (optional alternative to the MCP server).
 *
 * `jev-code setup opencode` registers the MCP server, which needs no files in your
 * project. If you prefer a native tool, copy this file to `.opencode/tools/jev.ts`
 * (project) or `~/.config/opencode/tools/jev.ts` (global) and add the package to the
 * matching package.json: `npm install @francoischastel/jev-code`.
 *
 * Each named export becomes a tool called `jev_<export>`, so the names line up with
 * the MCP server and the Pi extension.
 */

import {
  askTool,
  checkTool,
  classifyTool,
  errorMessage,
  JevClient,
  rankTool,
  scoreTool,
  type ToolDefinition,
} from "@francoischastel/jev-code";
import { tool } from "@opencode-ai/plugin";

let client: JevClient | undefined;
const getClient = (): JevClient => {
  client ??= JevClient.fromEnv(process.env, { userAgent: "jev-code opencode-tool" });
  return client;
};

const z = tool.schema;

const item = z.object({
  id: z.string().describe("Your identifier for this entry, echoed back verbatim."),
  text: z.string().describe("The entry's text; truncated at 4000 characters."),
});

const context = z
  .any()
  .optional()
  .describe(
    "Optional shared context every entry is judged against. Raw evidence, not your conclusion.",
  );

const probability = (description: string) =>
  z.number().min(0).max(1).optional().describe(description);

function define<TInput, TOutput>(
  definition: ToolDefinition<TInput, TOutput>,
  args: Parameters<typeof tool>[0]["args"],
) {
  return tool({
    description: definition.description,
    args,
    async execute(input) {
      try {
        const result = await definition.run(getClient(), input as TInput);
        return JSON.stringify(result, null, 2);
      } catch (error) {
        return `${definition.name} failed: ${errorMessage(error)}`;
      }
    },
  });
}

export const classify = define(classifyTool, {
  items: z.array(item).describe("Entries to label, up to 64 per call."),
  classes: z
    .record(z.string(), z.string().nullable())
    .describe("Label to description; include a catch-all such as other. 2 to 250 classes."),
  instructions: z.string().optional().describe("What the classification is about."),
  context,
  auto_accept: probability(
    "Top probability at or above which a label is auto-accepted. Default 0.85.",
  ),
  min_margin: probability("Minimum winner-to-runner-up gap for auto-acceptance. Default 0.5."),
});

export const check = define(checkTool, {
  state: z
    .any()
    .describe(
      "The evidence to judge: a diff, log, message, page, or JSON object with named parts.",
    ),
  checks: z
    .record(
      z.string(),
      z.union([
        z.string(),
        z.object({ question: z.string(), yes: z.string().optional(), no: z.string().optional() }),
      ]),
    )
    .describe("Check id to yes/no question, phrased so a high probability means yes. Up to 64."),
  yes_at: probability("Probability at or above which the verdict is yes. Default 0.75."),
  no_at: probability("Probability at or below which the verdict is no. Default 0.25."),
});

export const score = define(scoreTool, {
  items: z.array(item).describe("Entries to rate, up to 64 per call."),
  levels: z.array(z.string()).describe("Ordered level descriptions, lowest first. 2 to 20 levels."),
  instructions: z.string().describe("The dimension being rated."),
  context,
  auto_accept: probability("Confidence at or above which a score is auto-accepted. Default 0.7."),
});

export const rank = define(rankTool, {
  query: z.string().describe("What you are looking for, in plain language."),
  candidates: z.array(item).describe("Candidates to rank, up to 250."),
  top_k: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Return only the best k. Default: all, sorted."),
  relevant_at: probability(
    "Relevance probability at or above which a candidate counts as relevant. Default 0.5.",
  ),
  context,
});

export const ask = define(askTool, {
  state: z
    .any()
    .describe("Content to judge: plain text, or a JSON object/array with named fields."),
  questions: z
    .record(
      z.string(),
      z.object({
        type: z.enum(["noul", "choice", "score"]),
        instructions: z.any(),
        criteria: z.any().optional(),
      }),
    )
    .describe("Question id to question; answers come back under the same ids."),
  model: z.string().optional().describe("Model override. Default jev-latest."),
});
