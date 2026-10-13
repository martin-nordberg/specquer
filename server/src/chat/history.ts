import { rename } from "node:fs/promises";
import { join } from "node:path";
import { type ChatTurn, MAX_STORED_QUESTIONS, chatHistorySchema } from "@specquer/shared/chat";
import { YAMLParseError, parse, stringify } from "yaml";
import { writeAtomically } from "../files.ts";
import { ensureUserFolder } from "../user-folder.ts";

/**
 * The chat history (Step 010, R6): one conversation per root folder, in
 * `.specquer/user/chat-history.yaml` (per user, ignored by Git). Written with the `yaml` package,
 * so answers are block scalars a person can read (decision D7), atomically and one write at a
 * time, keeping the last 200 turns. A file that isn't valid YAML is moved aside and an empty
 * conversation starts; invalid turns are dropped one by one. It never stops the server.
 */

export const CHAT_HISTORY_FILE = join(".specquer", "user", "chat-history.yaml");

const HEADER = "# Specquer's chat history for this folder, per user; not committed. Clear it from the chat pane.\n";

export class ChatHistoryFile {
  private readonly file: string;
  private readonly folder: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    root: string,
    private readonly now: () => number = Date.now,
    private readonly warn: (message: string) => void = (message) => console.warn(`specquer: ${message}`),
  ) {
    this.file = join(root, CHAT_HISTORY_FILE);
    this.folder = join(root, ".specquer", "user");
  }

  /** Runs reads and writes one at a time. */
  private run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task);
    this.queue = result.catch(() => undefined);
    return result;
  }

  /** The conversation, oldest first. */
  read(): Promise<ChatTurn[]> {
    return this.run(() => this.load());
  }

  /** Appends a turn, dropping the oldest beyond the limit. */
  append(turn: ChatTurn): Promise<void> {
    return this.run(async () => this.save([...(await this.load()), turn]));
  }

  /** Empties the conversation; returns what was cleared, for Undo. */
  clear(): Promise<ChatTurn[]> {
    return this.run(async () => {
      const turns = await this.load();
      if (turns.length > 0) await this.save([]);
      return turns;
    });
  }

  /** Puts cleared turns back, in front of any added since. */
  restore(turns: ChatTurn[]): Promise<ChatTurn[]> {
    return this.run(async () => {
      const restored = [...turns, ...(await this.load())];
      await this.save(restored);
      return restored.slice(-MAX_STORED_QUESTIONS);
    });
  }

  private async load(): Promise<ChatTurn[]> {
    const file = Bun.file(this.file);
    if (!(await file.exists())) return [];
    let text: string;
    try {
      text = await file.text();
    } catch (err) {
      this.warn(`${CHAT_HISTORY_FILE} can't be read: ${(err as Error).message}`);
      return [];
    }
    let value: unknown;
    try {
      value = parse(text);
    } catch (err) {
      if (!(err instanceof YAMLParseError)) throw err;
      const aside = `${this.file}.damaged-${this.now()}`;
      this.warn(`${CHAT_HISTORY_FILE} isn't valid YAML (${err.message.split("\n")[0]}); moved to ${aside}`);
      await rename(this.file, aside).catch(() => undefined);
      return [];
    }
    return chatHistorySchema.parse(value ?? {}).turns;
  }

  private async save(turns: ChatTurn[]): Promise<void> {
    await ensureUserFolder(this.folder);
    const kept = turns.slice(-MAX_STORED_QUESTIONS);
    await writeAtomically(this.file, HEADER + stringify({ version: 1, turns: kept }, { lineWidth: 0 }));
  }
}
