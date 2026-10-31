const PATTERN_1 = /[.*+?^${}()|[\]\\]/gu;
export type Trigger = "always" | "addressed" | "never";

export interface ReplyPolicyOptions {
  allowedGroups?: string[] | undefined;
  direct?: Trigger | undefined;
  group?: Trigger | undefined;
  names?: string[] | undefined;
  random?: (() => number) | undefined;
  unpromptedProbability?: number | undefined;
}

export interface ReplyPolicy {
  shouldReply: (msg: {
    isGroup: boolean;
    chatId: string;
    text: string;
    mentioned: boolean;
  }) => Trigger;
}

function escapeRegExp(s: string): string {
  return s.replace(PATTERN_1, "\\$&");
}

export function mentionsName(text: string, name: string): boolean {
  const n = escapeRegExp(name);
  const re = new RegExp(
    `(?:^|[^\\p{L}\\p{N}_])@?${n}(?=$|[^\\p{L}\\p{N}_])`,
    "iu"
  );
  return re.test(text);
}

export function createReplyPolicy(opts: ReplyPolicyOptions = {}): ReplyPolicy {
  const direct = opts.direct ?? "addressed";
  const group = opts.group ?? "addressed";
  const names = opts.names ?? [];
  const allowedGroups = opts.allowedGroups ?? [];
  const probability = opts.unpromptedProbability ?? 0;
  const random = opts.random ?? Math.random;

  function triggerFor(ctx: { isGroup: boolean }): Trigger {
    return ctx.isGroup ? group : direct;
  }

  return {
    shouldReply(msg) {
      // Hard deny: an allowlisted-out group never gets a reply, even when mentioned.
      if (
        msg.isGroup &&
        allowedGroups.length > 0 &&
        !allowedGroups.includes(msg.chatId)
      ) {
        return "never";
      }
      const mentioned =
        msg.mentioned || names.some((n) => mentionsName(msg.text, n));
      if (triggerFor(msg) === "always" || mentioned) {
        return "always";
      }
      return random() < probability ? "always" : "never";
    },
  };
}
