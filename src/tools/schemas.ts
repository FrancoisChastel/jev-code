import { z } from "zod";
import { LIMITS } from "../core/limits.js";

const idField = z
  .string()
  .min(1)
  .max(200)
  .describe(
    "Your identifier for this entry, echoed back verbatim (file path, issue number, line id).",
  );

const textField = z
  .string()
  .min(1)
  .describe(`The entry's text. Truncated at ${LIMITS.itemChars} characters with a marker.`);

export const itemSchema = z.object({ id: idField, text: textField });

export const itemsSchema = z
  .array(itemSchema)
  .min(1)
  .max(LIMITS.maxItems)
  .describe(`Entries to judge, up to ${LIMITS.maxItems} per call. Split larger sets into batches.`);

export const contextSchema = z
  .union([z.string(), z.record(z.string(), z.any()), z.array(z.any())])
  .optional()
  .describe(
    "Optional shared context every entry is judged against: the user's request, a policy, a taxonomy note. Plain text or a JSON object. Raw evidence, not your conclusion.",
  );

const probability = z.number().min(0).max(1);

export const classifyInputSchema = z.object({
  items: itemsSchema,
  classes: z
    .record(z.string().min(1).max(100), z.string().nullable())
    .refine((classes) => Object.keys(classes).length >= 2, {
      message: "classes needs at least 2 entries.",
    })
    .refine((classes) => Object.keys(classes).length <= LIMITS.maxClasses, {
      message: `classes allows at most ${LIMITS.maxClasses} entries.`,
    })
    .describe(
      `Label to description. Descriptions carry the decision: say what belongs, what does not, and how the class differs from its neighbours. Include a catch-all such as "other" when an item might fit nothing. 2 to ${LIMITS.maxClasses} classes.`,
    ),
  instructions: z
    .string()
    .optional()
    .describe(
      'What the classification is about, e.g. "Route each GitHub issue to the team that owns it". Applies to every item.',
    ),
  context: contextSchema,
  auto_accept: probability
    .optional()
    .describe("Top probability at or above which a label is auto-accepted. Default 0.85."),
  min_margin: probability
    .optional()
    .describe("Minimum gap between the winner and the runner-up for auto-acceptance. Default 0.5."),
});

const checkQuestionSchema = z.union([
  z.string().min(1).describe("The yes/no question, phrased so that a high probability means yes."),
  z.object({
    question: z.string().min(1).describe("The yes/no question or statement to evaluate."),
    yes: z.string().optional().describe("What a yes means, when the boundary is subtle."),
    no: z.string().optional().describe("What a no means, when the boundary is subtle."),
  }),
]);

export const checkInputSchema = z.object({
  state: z
    .union([z.string(), z.record(z.string(), z.any()), z.array(z.any())])
    .describe(
      "The evidence to judge: a diff, a log, a message, a page, or a JSON object with named parts. Reference named parts in questions with backticks, e.g. `diff`. Pass observed evidence, not your conclusion.",
    ),
  checks: z
    .record(z.string().min(1).max(100), checkQuestionSchema)
    .refine((checks) => Object.keys(checks).length >= 1, { message: "checks must not be empty." })
    .refine((checks) => Object.keys(checks).length <= LIMITS.maxChecks, {
      message: `checks allows at most ${LIMITS.maxChecks} entries.`,
    })
    .describe(
      `Check id to yes/no question. Ids are for you and are not sent to the model, so put the whole question in the text. Up to ${LIMITS.maxChecks} checks; they run in parallel.`,
    ),
  yes_at: probability
    .optional()
    .describe("Probability at or above which the verdict is yes. Default 0.75."),
  no_at: probability
    .optional()
    .describe("Probability at or below which the verdict is no. Default 0.25."),
});

export const scoreInputSchema = z.object({
  items: itemsSchema,
  levels: z
    .array(z.string().min(1))
    .min(2)
    .max(LIMITS.maxLevels)
    .describe(
      'Ordered level descriptions, lowest first, each describing a concrete situation. E.g. ["Cosmetic: no user impact", "Minor: workaround exists", "Major: core flow broken", "Critical: data loss or outage"].',
    ),
  instructions: z
    .string()
    .min(1)
    .describe('The dimension being rated, e.g. "How severe is this bug report for end users?"'),
  context: contextSchema,
  auto_accept: probability
    .optional()
    .describe("Confidence at or above which a score is auto-accepted. Default 0.7."),
});

export const rankInputSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe(
      'What you are looking for, in plain language, e.g. "where is the retry policy for outbound HTTP calls configured?"',
    ),
  candidates: z
    .array(itemSchema)
    .min(1)
    .max(LIMITS.maxCandidates)
    .describe(
      `Candidates to rank, up to ${LIMITS.maxCandidates}. Use file paths or symbol names as ids and an excerpt as text.`,
    ),
  top_k: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Return only the best k candidates. Default: all, sorted."),
  relevant_at: probability
    .optional()
    .describe(
      "Relevance probability at or above which a candidate is marked relevant. Default 0.5.",
    ),
  context: contextSchema,
});

const questionTypeSchema = z.enum(["noul", "choice", "score"]);

export const askInputSchema = z.object({
  state: z
    .union([z.string(), z.record(z.string(), z.any()), z.array(z.any())])
    .describe("Content to judge: plain text, or a JSON object/array with named fields."),
  questions: z
    .record(
      z.string().min(1).max(100),
      z.object({
        type: questionTypeSchema.describe(
          "noul: probability a yes/no condition holds. choice: one option from the criteria map. score: position on ordered criteria levels.",
        ),
        instructions: z
          .any()
          .describe(
            "The judgment to make, complete on its own: the id is not sent to the model. A string, or an object/array for definitions and examples.",
          ),
        criteria: z
          .any()
          .optional()
          .describe(
            'choice (required): map of option to description or null. score (required): ordered array of at least 2 level descriptions. noul (optional): {"true": ..., "false": ...}.',
          ),
      }),
    )
    .refine((questions) => Object.keys(questions).length >= 1, {
      message: "questions must not be empty.",
    })
    .describe("Question id to question. Answers come back under the same ids."),
  model: z.string().optional().describe("Model override. Default: jev-latest."),
});

export type ClassifyInput = z.infer<typeof classifyInputSchema>;
export type CheckInput = z.infer<typeof checkInputSchema>;
export type ScoreInput = z.infer<typeof scoreInputSchema>;
export type RankInput = z.infer<typeof rankInputSchema>;
export type AskInput = z.infer<typeof askInputSchema>;
