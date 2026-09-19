/**
 * Pi extension: registers every jev_* tool natively (pi has no MCP client).
 *
 * Installed by `pi install npm:@francoischastel/jev-code` (the package manifest points
 * pi at this directory) or by `jev-code setup pi`. The extension imports the package's
 * own build, so the tool contract has a single source of truth: src/tools.
 *
 * Reads TYPESAFE_API_KEY from the shell pi runs in.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  errorMessage,
  JevClient,
  LIMITS,
  TOOLS,
  type ToolDefinition,
  type ToolName,
} from "../../dist/index.js";

const item = Type.Object({
  id: Type.String({ description: "Your identifier for this entry, echoed back verbatim." }),
  text: Type.String({
    description: `The entry's text; truncated at ${LIMITS.itemChars} characters.`,
  }),
});

const context = Type.Optional(
  Type.Any({
    description:
      "Optional shared context every entry is judged against (the user's request, a policy). Text or JSON; raw evidence, not your conclusion.",
  }),
);

const probability = (description: string) =>
  Type.Optional(Type.Number({ minimum: 0, maximum: 1, description }));

// Hand-written TypeBox mirrors of src/tools/schemas.ts. Records are expressed with
// additionalProperties rather than Type.Record, which emits patternProperties that some
// providers reject. Inputs are re-validated with the zod schemas inside tool.run().
const PARAMETERS: Record<ToolName, ReturnType<typeof Type.Object>> = {
  jev_classify: Type.Object({
    items: Type.Array(item, {
      description: `Entries to label, up to ${LIMITS.maxItems} per call.`,
    }),
    classes: Type.Object(
      {},
      {
        additionalProperties: Type.Union([Type.String(), Type.Null()]),
        description:
          "Label to description. Describe what belongs, what does not, and how neighbours differ; include a catch-all such as other. 2 to 250 classes.",
      },
    ),
    instructions: Type.Optional(
      Type.String({ description: "What the classification is about; applies to every item." }),
    ),
    context,
    auto_accept: probability(
      "Top probability at or above which a label is auto-accepted. Default 0.85.",
    ),
    min_margin: probability("Minimum winner-to-runner-up gap for auto-acceptance. Default 0.5."),
  }),
  jev_check: Type.Object({
    state: Type.Any({
      description:
        "The evidence to judge: a diff, log, message, page, or JSON object with named parts (reference them with backticks). Raw evidence, not your conclusion.",
    }),
    checks: Type.Object(
      {},
      {
        additionalProperties: Type.Union([
          Type.String(),
          Type.Object({
            question: Type.String(),
            yes: Type.Optional(Type.String()),
            no: Type.Optional(Type.String()),
          }),
        ]),
        description: `Check id to yes/no question, phrased so a high probability means yes. Up to ${LIMITS.maxChecks}.`,
      },
    ),
    yes_at: probability("Probability at or above which the verdict is yes. Default 0.75."),
    no_at: probability("Probability at or below which the verdict is no. Default 0.25."),
  }),
  jev_score: Type.Object({
    items: Type.Array(item, { description: `Entries to rate, up to ${LIMITS.maxItems} per call.` }),
    levels: Type.Array(Type.String(), {
      description:
        "Ordered level descriptions, lowest first, each a concrete situation. 2 to 20 levels.",
    }),
    instructions: Type.String({
      description: "The dimension being rated, e.g. how severe is this bug for end users?",
    }),
    context,
    auto_accept: probability("Confidence at or above which a score is auto-accepted. Default 0.7."),
  }),
  jev_rank: Type.Object({
    query: Type.String({ description: "What you are looking for, in plain language." }),
    candidates: Type.Array(item, {
      description: `Candidates to rank, up to ${LIMITS.maxCandidates}; use paths or symbol names as ids and an excerpt as text.`,
    }),
    top_k: Type.Optional(
      Type.Integer({ minimum: 1, description: "Return only the best k. Default: all, sorted." }),
    ),
    relevant_at: probability(
      "Relevance probability at or above which a candidate counts as relevant. Default 0.5.",
    ),
    context,
  }),
  jev_ask: Type.Object({
    state: Type.Any({
      description: "Content to judge: plain text, or a JSON object/array with named fields.",
    }),
    questions: Type.Object(
      {},
      {
        additionalProperties: Type.Object({
          type: Type.String({
            description:
              "noul (yes/no probability), choice (one option from criteria), or score (position on ordered criteria).",
          }),
          instructions: Type.Any({
            description: "The complete judgment to make; ids are not sent to the model.",
          }),
          criteria: Type.Optional(
            Type.Any({
              description:
                'choice (required): map of option to description or null; score (required): ordered array of at least 2 levels; noul (optional): {"true": ..., "false": ...}.',
            }),
          ),
        }),
        description: "Question id to question; answers come back under the same ids.",
      },
    ),
    model: Type.Optional(Type.String({ description: "Model override. Default jev-latest." })),
  }),
};

export default function jevExtension(pi: ExtensionAPI): void {
  let client: JevClient | undefined;
  const getClient = (): JevClient => {
    client ??= JevClient.fromEnv(process.env, { userAgent: "jev-code pi-extension" });
    return client;
  };

  for (const tool of TOOLS as readonly ToolDefinition<unknown, unknown>[]) {
    pi.registerTool({
      name: tool.name,
      label: tool.title,
      description: tool.description,
      promptSnippet: tool.promptSnippet,
      promptGuidelines: [...tool.guidelines],
      parameters: PARAMETERS[tool.name],
      async execute(_toolCallId, params, signal) {
        if (signal?.aborted) throw new Error(`${tool.name}: aborted`);
        try {
          const result = await tool.run(getClient(), params, { signal });
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            details: result,
          };
        } catch (error) {
          // Throwing marks the tool result as an error for the model.
          throw new Error(`${tool.name} failed: ${errorMessage(error)}`);
        }
      },
    });
  }
}
