import { computeTopicTags } from "./topic";
import type { ContextWeights, IncomingMessage, LearningState } from "./types";

/** Where a message sits for weight lookup: its context, and its topic if it has one. */
export interface ContextLookup {
  context: string;
  topic?: string | undefined;
}

/** The first topic word of a message's text. Undefined when the text has none. */
export function topicOf(text: string): string | undefined {
  return computeTopicTags(text)[0];
}

/** Where a message sits for weight lookup. The topic comes from the text alone, not the sender. */
export function contextLookup(msg: IncomingMessage): ContextLookup {
  return { context: contextKey(msg), topic: topicOf(msg.text) };
}

/**
 * The learned weights that apply to a message: its topic if one has weights,
 * otherwise its context. `undefined` means the global weights apply.
 */
export function resolveContextWeights(
  state: LearningState,
  lookup: ContextLookup
): ContextWeights | undefined {
  const byTopic =
    lookup.topic === undefined ? undefined : state.topics?.[lookup.topic];
  return byTopic ?? state.contexts?.[lookup.context];
}

/** Where a message came from, used to pick the weights it learns into. */
export function contextKey(msg: IncomingMessage): string {
  if (!msg.isGroup) {
    return "dm";
  }
  if (
    typeof msg.participantCount === "number" &&
    Number.isFinite(msg.participantCount)
  ) {
    return `group:${msg.participantCount}`;
  }
  return "group";
}

/** A two-hour bucket of the local day: `h0` (00:00–01:59) through `h11`. */
export function hourBucket(ts: number): string {
  const hour = new Date(ts).getHours();
  return `h${Math.floor(hour / 2)}`;
}

/** Weights for a context that has no entry yet, seeded from the global defaults. */
export function defaultContextWeights(state: LearningState): ContextWeights {
  return {
    prompt: {
      ...state.prompt,
      extraRules: [...state.prompt.extraRules],
    },
    recall: { ...state.recall },
  };
}
