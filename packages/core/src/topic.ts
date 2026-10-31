const PATTERN_1 = /[^a-z0-9]+/u;
const TOPIC_TAG_COUNT = 3;
const MIN_TOPIC_TOKEN_CHARS = 3;

/** The first few distinct words of three or more letters, lower-cased. */
export function computeTopicTags(text: string): string[] {
  const tokens = text
    .toLowerCase()
    .split(PATTERN_1)
    .filter((t) => t.length >= MIN_TOPIC_TOKEN_CHARS);
  return [...new Set(tokens)].slice(0, TOPIC_TAG_COUNT);
}
