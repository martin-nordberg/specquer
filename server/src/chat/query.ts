/**
 * Turning a question into an FTS5 query (Step 010, R4.6). The question is split into words, stop
 * words are dropped, and each term is quoted, so FTS5's own syntax in a question (`"`, `*`, `-`,
 * `NEAR`, `AND`, column filters) can't break or steer the search. Terms are joined with `OR`;
 * bm25 ranks units holding more of them, and rarer ones, higher.
 */

const STOP_WORDS = new Set(
  `a about above after again against all am an and any are aren't as at be because been before being below between both
  but by can can't cannot could couldn't did didn't do does doesn't doing don't down during each few for from further
  had hadn't has hasn't have haven't having he her here hers herself him himself his how i if in into is isn't it it's
  its itself let's me more most mustn't my myself no nor not of off on once only or other ought our ours ourselves out
  over own same shan't she should shouldn't so some such than that that's the their theirs them themselves then there
  there's these they this those through to too under until up very was wasn't we were weren't what what's when when's
  where where's which while who who's whom why why's will with won't would wouldn't you your yours yourself yourselves
  also just get gets got please tell explain describe does say says said happens happen anything something thing things
  doc docs document documents spec specs`
    .split(/\s+/)
    .filter((word) => word !== ""),
);

/** The question's search terms: lower-case words, without stop words and single letters. */
export function queryTerms(question: string): string[] {
  const words = question.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'_]*/gu) ?? [];
  const terms: string[] = [];
  for (const raw of words) {
    const word = raw.replace(/'s$/, "").replace(/'/g, "");
    if (word.length < 2 || STOP_WORDS.has(raw) || STOP_WORDS.has(word) || terms.includes(word)) continue;
    terms.push(word);
  }
  return terms;
}

/**
 * The FTS5 query for a question, with a follow-up's previous question's terms added; `undefined`
 * when no term is left.
 */
export function ftsQuery(question: string, previousQuestion?: string): string | undefined {
  const terms = queryTerms(question);
  for (const term of previousQuestion === undefined ? [] : queryTerms(previousQuestion)) if (!terms.includes(term)) terms.push(term);
  if (terms.length === 0) return undefined;
  return terms.map((term) => `"${term.replace(/"/g, '""')}"`).join(" OR ");
}
