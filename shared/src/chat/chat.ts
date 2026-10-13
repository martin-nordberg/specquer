import { z } from "zod";
import { markdownPathSchema } from "../paths/paths.ts";

/**
 * Document chat (Step 010), shared by client and server: the request, the events of the answer's
 * stream, the citations and the stored history.
 */

/** The longest question the input accepts. */
export const MAX_QUESTION_LENGTH = 8000;

/** The most questions, with their answers, kept in the history file. */
export const MAX_STORED_QUESTIONS = 200;

export const chatRequestSchema = z.object({
  question: z
    .string()
    .max(MAX_QUESTION_LENGTH, `A question holds at most ${MAX_QUESTION_LENGTH} characters.`)
    .refine((text) => text.trim() !== "", "The question is empty."),
  /** The open document, whose sections rank higher. */
  openFile: markdownPathSchema.optional(),
});
export type ChatRequest = z.infer<typeof chatRequestSchema>;

/**
 * A retrieved unit the answer may cite as `[n]`: a heading section of a Markdown file, with its
 * section ID when the section index holds one there.
 */
export const citationSchema = z.object({
  n: z.number().int().min(1),
  path: z.string(),
  /** The heading's outline path (`1.0.2`), or "" for the text before the first heading. */
  outlinePath: z.string(),
  sectionId: z.string().optional(),
  title: z.string(),
});
export type Citation = z.infer<typeof citationSchema>;

/** The events of `POST /api/chat`'s stream, in order: status, citations, status, tokens, done (or error). */
export const chatEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("status"), phase: z.enum(["searching", "thinking"]) }),
  z.object({ type: z.literal("citations"), citations: z.array(citationSchema) }),
  z.object({ type: z.literal("token"), text: z.string() }),
  z.object({
    type: z.literal("done"),
    /** The model's ID, and its name as shown (after the last `/`). */
    model: z.string(),
    /** From the server receiving the question to the end of the answer. */
    elapsedMs: z.number().int().min(0),
    /** When the answer ended (ISO). */
    at: z.string(),
  }),
  z.object({ type: z.literal("error"), code: z.string(), message: z.string() }),
]);
export type ChatEvent = z.infer<typeof chatEventSchema>;

export const chatAnswerSchema = z.object({
  /** The answer's Markdown, as the model wrote it. */
  text: z.string(),
  model: z.string(),
  elapsedMs: z.number().int().min(0),
  at: z.string(),
  /** Stopped by the user before the end. */
  stopped: z.boolean(),
  citations: z.array(citationSchema),
});
export type ChatAnswer = z.infer<typeof chatAnswerSchema>;

export const chatTurnSchema = z.object({
  question: z.object({ text: z.string(), at: z.string() }),
  answer: chatAnswerSchema,
});
export type ChatTurn = z.infer<typeof chatTurnSchema>;

/** The stored conversation. Invalid turns are dropped one by one. */
export const chatHistorySchema = z.object({
  version: z.literal(1).catch(1),
  turns: z
    .array(z.unknown())
    .transform((turns) => turns.flatMap((turn) => {
      const parsed = chatTurnSchema.safeParse(turn);
      return parsed.success ? [parsed.data] : [];
    }))
    .catch([]),
});
export type ChatHistory = z.output<typeof chatHistorySchema>;

/** `PUT /api/chat/history`: turns cleared a moment ago, put back in front of any added since (Undo). */
export const chatRestoreSchema = z.object({ turns: z.array(chatTurnSchema).max(MAX_STORED_QUESTIONS) });

/**
 * The thinking time as shown: "under 1 s", "12 s", "1 min 12 s".
 */
export function formatElapsed(ms: number): string {
  if (ms < 1000) return "under 1 s";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`;
}
