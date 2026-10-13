/** The user's question (Step 010, R3.3): against the pane's right edge, at most 85% wide, its lines left-aligned, plain text as typed. */
export function QuestionBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <p aria-label="Your question" className="max-w-[85%] rounded-md bg-secondary px-3 py-2 text-left text-sm whitespace-pre-wrap text-secondary-foreground">
        {text}
      </p>
    </div>
  );
}
