/** The text of a model message's content: a string, or the text parts of a list of parts. */
export function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => (typeof part === "string" ? part : part?.type === "text" && typeof part.text === "string" ? part.text : "")).join("");
  }
  return "";
}
