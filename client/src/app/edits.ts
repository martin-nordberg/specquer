import { diff } from "@codemirror/merge";
import { ChangeSet, Text } from "@codemirror/state";
import type { BodyEdit } from "@specquer/shared/markdown";

/** The minimal changes that turn one text into another. */
export function changesBetween(from: string, to: string): ChangeSet {
  const changes = diff(from, to).map((change) => ({ from: change.fromA, to: change.toA, insert: to.slice(change.fromB, change.toB) }));
  return ChangeSet.of(changes, from.length);
}

/**
 * Applies edits made by the server to the text it was sent (`sent`) to the text as it is now
 * (`current`, which may hold changes typed while the save was under way): the edits are mapped
 * through those changes, so both survive.
 */
export function rebaseEdits(sent: string, current: string, edits: readonly BodyEdit[]): string {
  const server = ChangeSet.of(
    edits.map((edit) => ({ from: edit.from, to: edit.to, insert: edit.insert })),
    sent.length,
  );
  const mapped = sent === current ? server : server.map(changesBetween(sent, current));
  return mapped.apply(Text.of(current.split("\n"))).toString();
}
