import { askTool } from "./ask.js";
import { checkTool } from "./check.js";
import { classifyTool } from "./classify.js";
import type { ToolDefinition, ToolName } from "./definition.js";
import { rankTool } from "./rank.js";
import { scoreTool } from "./score.js";

/** Every tool, in the order harnesses list them. */
export const TOOLS: readonly ToolDefinition<any, any>[] = [
  classifyTool,
  checkTool,
  scoreTool,
  rankTool,
  askTool,
];

export const TOOL_NAMES: readonly ToolName[] = TOOLS.map((tool) => tool.name);

export function findTool(name: string): ToolDefinition<any, any> | undefined {
  return TOOLS.find((tool) => tool.name === name || tool.name === `jev_${name}`);
}

/** Guidance shared with every harness that accepts server- or tool-level instructions. */
export const USAGE_GUIDANCE = [
  "Jev returns typed answers with calibrated probabilities, not prose. Keep the workflow in your own reasoning and use Jev for the narrow judgments inside it.",
  "Pass raw evidence as state (the text, diff, log, or page), never your own conclusion about it; a conclusion asserted in state biases the answer.",
  "Batch: send every item or question about the same evidence in one call. Extra questions cost tokens, not latency.",
  "Write complete questions and class descriptions; ids are for you and are not sent to the model. Include a catch-all class when nothing may fit.",
  "Act on decision=auto results; look at decision=review and verdict=uncertain results yourself or ask the user. Thresholds are parameters, tune them to the stakes.",
  "Jev is calibrated, not infallible. Typed output guarantees the interface, not the truth.",
] as const;

export * from "./ask.js";
export * from "./check.js";
export * from "./classify.js";
export * from "./common.js";
export type { ToolDefinition, ToolName } from "./definition.js";
export { parseInput } from "./definition.js";
export * from "./policy.js";
export * from "./rank.js";
export * from "./schemas.js";
export * from "./score.js";
export { askTool, checkTool, classifyTool, rankTool, scoreTool };
