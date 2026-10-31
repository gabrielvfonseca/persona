import type { BotState } from "@persona/core";

const PATTERN_1 = /\D/gu;
const PATTERN_2 = /\s+/u;

export type CommandHandler = (
  args: string[],
  ctx: { chatId?: string | undefined }
) => Promise<string | undefined>;

export interface Command {
  admin?: boolean | undefined;
  description: string;
  handler: CommandHandler;
  name: string;
}

export interface CommandsOptions {
  adminNumbers: string[];
  botName: string;
  /** Called when an admin asks to export the fine-tune dataset. */
  onDataset?: () => string | undefined | Promise<string | undefined>;
  /** Called when an admin asks to run distillation now. */
  onDistill?: () => Promise<string | undefined>;
  /** Called when an admin adds a fact with !learn. Without it, !learn says so. */
  onLearn?: (
    fact: string,
    ctx: { chatId?: string | undefined }
  ) => void | Promise<void>;
  /** Called when an admin rates the last reply. The sink is fire-and-forget. */
  onRate?: (
    chatId: string,
    rating: number,
    comment?: string
  ) => void | Promise<void> | undefined;
  /** Called when an admin asks for the current learning weights. */
  onWeights?: () => string | undefined;
  state: BotState;
}

/** The learning and fact hooks, without the required identity fields. */
export type CommandHooks = Pick<
  CommandsOptions,
  "onRate" | "onWeights" | "onDataset" | "onDistill" | "onLearn"
>;

export function createCommands(opts: CommandsOptions) {
  const { adminNumbers, botName, state } = opts;

  const whois: Command = {
    description: "Says who the bot is.",
    handler: () =>
      Promise.resolve(`${botName} 🤖 - I'm an AI twin of ${botName}.`),
    name: "!whois",
  };

  const pause: Command = {
    admin: true,
    description: "Pauses the bot (admins only).",
    handler: () => {
      state.setPaused(true);
      return Promise.resolve("Bot paused.");
    },
    name: "!pause",
  };

  const resume: Command = {
    admin: true,
    description: "Resumes the bot (admins only).",
    handler: () => {
      state.setPaused(false);
      return Promise.resolve("Bot resumed.");
    },
    name: "!resume",
  };

  const good: Command = {
    admin: true,
    description: "Rate the last reply as good (admins only).",
    handler: async (_args, ctx) => {
      if (!opts.onRate) {
        return "Learning is not enabled.";
      }
      await opts.onRate(ctx?.chatId ?? "unknown", 1, undefined);
      return "Marked good.";
    },
    name: "!good",
  };

  const bad: Command = {
    admin: true,
    description: "Rate the last reply as bad (admins only).",
    handler: async (args, ctx) => {
      if (!opts.onRate) {
        return "Learning is not enabled.";
      }
      const comment = args.join(" ").trim() || undefined;
      await opts.onRate(ctx?.chatId ?? "unknown", -1, comment);
      return comment ? `Marked bad: ${comment}` : "Marked bad.";
    },
    name: "!bad",
  };

  const weights: Command = {
    admin: true,
    description: "Show the current learning weights (admins only).",
    handler: () =>
      Promise.resolve(opts.onWeights?.() ?? "Learning is not enabled."),
    name: "!weights",
  };

  const dataset: Command = {
    admin: true,
    description: "Export the fine-tune dataset (admins only).",
    handler: async () =>
      (await opts.onDataset?.()) ?? "Learning is not enabled.",
    name: "!dataset",
  };

  const learn: Command = {
    admin: true,
    description: "Learn a fact from this conversation (admins only).",
    handler: async (args, ctx) => {
      const text = args.join(" ").trim();
      if (!text) {
        return "Usage: !learn <fact>";
      }
      if (!opts.onLearn) {
        return "Fact storage is not enabled.";
      }
      await opts.onLearn(text, ctx ?? {});
      return "Learned.";
    },
    name: "!learn",
  };

  const distill: Command = {
    admin: true,
    description: "Run distillation now (admins only).",
    handler: () =>
      Promise.resolve(opts.onDistill?.() ?? "Learning is not enabled."),
    name: "!distill",
  };

  const commands: Command[] = [
    whois,
    pause,
    resume,
    good,
    bad,
    weights,
    dataset,
    learn,
    distill,
  ];

  function isAdmin(participant: string): boolean {
    const [at] = participant.split("@");
    const user = at?.split(":")[0] ?? "";
    return adminNumbers.includes(user);
  }

  function normalizeId(id: string): string {
    return id.replace(PATTERN_1, "");
  }

  async function handle(
    text: string,
    participant: string,
    ctx?: { chatId?: string | undefined }
  ): Promise<{ handled: boolean; reply?: string | undefined }> {
    const trimmed = text.trim();
    const cmd = commands.find(
      (c) => trimmed === c.name || trimmed.startsWith(`${c.name} `)
    );
    if (!cmd) {
      return { handled: false };
    }

    if (cmd.admin && !isAdmin(participant)) {
      return { handled: false };
    }

    const rest = trimmed.slice(cmd.name.length);
    const args = rest.trim().split(PATTERN_2).filter(Boolean);
    const reply = await cmd.handler(args, ctx ?? {});
    return { handled: true, reply };
  }

  return {
    bad,
    commands,
    dataset,
    distill,
    good,
    handle,
    isAdmin,
    learn,
    normalizeId,
    pause,
    resume,
    weights,
    whois,
  };
}
