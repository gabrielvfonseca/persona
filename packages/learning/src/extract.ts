import type { HandleResult, IncomingMessage, Turn } from "@persona/core";

/** A single signal the learning engine can act on. */
export interface Outcome {
  msg: IncomingMessage;
  result: HandleResult;
  systemPrompt: string;
  historyTurns: Turn[];
  recallLines: string[];
  replyText?: string | undefined;
  timestamp: number;
}

/**
 * Turns a pipeline outcome into a learning signal. The result kind is the signal:
 * `replied` is positive, `failed` is negative, `skipped` is neutral (no model was
 * called), and `command` is neutral (no reply was generated).
 */
export function outcomeSignal(outcome: Outcome): -1 | 0 | 1 {
  switch (outcome.result.kind) {
    case "replied":
      return 1;
    case "failed":
      return -1;
    default:
      return 0;
  }
}

/** True when the reply was actually generated and sent. */
export function wasReplied(outcome: Outcome): boolean {
  return outcome.result.kind === "replied";
}

/** True when generation or sending failed. */
export function wasFailed(outcome: Outcome): boolean {
  return outcome.result.kind === "failed";
}

/** The user turn that triggered this outcome, if any. */
export function userTurn(outcome: Outcome): Turn | undefined {
  const text =
    outcome.msg.isGroup && outcome.msg.senderName
      ? `${outcome.msg.senderName}: ${outcome.msg.text}`
      : outcome.msg.text;
  return { role: "user", content: text };
}
