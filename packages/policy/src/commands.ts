import type { BotState } from "@persona/core";

export type CommandHandler = (args: string[]) => Promise<string | undefined>;

export interface Command {
  name: string;
  description: string;
  admin?: boolean | undefined;
  handler: CommandHandler;
}

export interface CommandsOptions {
  adminNumbers: string[];
  botName: string;
  state: BotState;
  /** Called when an admin rates the last reply. The sink is fire-and-forget. */
  onRate?: (
    chatId: string,
    rating: number,
    comment?: string,
  ) => void | Promise<void> | undefined;
  /** Called when an admin asks for the current learning weights. */
  onWeights?: () => string | undefined;
  /** Called when an admin asks to export the fine-tune dataset. */
  onDataset?: () => string | undefined;
  /** Called when an admin asks to run distillation now. */
  onDistill?: () => Promise<string | undefined>;
}

export function createCommands(opts: CommandsOptions) {
  const { adminNumbers, botName, state } = opts;

  const whois: Command = {
    name: "!whois",
    description: "Says who the bot is.",
    handler: async () => `${botName} 🤖 - I'm an AI twin of ${botName}.`,
  };

  const pause: Command = {
    name: "!pause",
    description: "Pauses the bot (admins only).",
    admin: true,
    handler: async () => {
      state.setPaused(true);
      return "Bot paused.";
    },
  };

  const resume: Command = {
    name: "!resume",
    description: "Resumes the bot (admins only).",
    admin: true,
    handler: async () => {
      state.setPaused(false);
      return "Bot resumed.";
    },
  };

  const good: Command = {
    name: "!good",
    description: "Rate the last reply as good (admins only).",
    admin: true,
    handler: async (_args, ctx) => {
      if (!opts.onRate) return "Learning is not enabled.";
      await opts.onRate(ctx?.chatId ?? "unknown", 1);
      return "Marked good.";
    },
  };

  const bad: Command = {
    name: "!bad",
    description: "Rate the last reply as bad (admins only).",
    admin: true,
    handler: async (_args, ctx) => {
      if (!opts.onRate) return "Learning is not enabled.";
      const comment = _args.join(" ").trim() || undefined;
      await opts.onRate(ctx?.chatId ?? "unknown", -1, comment);
      return comment ? `Marked bad: ${comment}` : "Marked bad.";
    },
  };

  const weights: Command = {
    name: "!weights",
    description: "Show the current learning weights (admins only).",
    admin: true,
    handler: async () => opts.onWeights?.() ?? "Learning is not enabled.",
  };

  const dataset: Command = {
    name: "!dataset",
    description: "Export the fine-tune dataset (admins only).",
    admin: true,
    handler: async () => opts.onDataset?.() ?? "Learning is not enabled.",
  };

  const learn: Command = {
    name: "!learn",
    description: "Learn a fact from this conversation (admins only).",
    admin: true,
    handler: async (args) => {
      const text = args.join(" ").trim();
      if (!text) return "Usage: !learn <fact>";
      return "Learned.";
    },
  };

  const distill: Command = {
    name: "!distill",
    description: "Run distillation now (admins only).",
    admin: true,
    handler: async () => opts.onDistill?.() ?? "Learning is not enabled.",
  };

  const commands: Command[] = [whois, pause, resume, good, bad, weights, dataset, learn, distill];

  function isAdmin(participant: string): boolean {
    const at = participant.split("@")[0];
    const user = at?.split(":")[0] ?? "";
    return adminNumbers.includes(user);
  }

  function normalizeId(id: string): string {
    return id.replace(/\D/g, "");
  }

  async function handle(
    text: string,
    participant: string,
    ctx?: { chatId?: string | undefined },
  ): Promise<{ handled: boolean; reply?: string | undefined }> {
    const trimmed = text.trim();
    const cmd = commands.find((c) => trimmed === c.name || trimmed.startsWith(c.name + " "));
    if (!cmd) return { handled: false };

    if (cmd.admin && !isAdmin(participant)) {
      return { handled: false };
    }

    const rest = trimmed.slice(cmd.name.length);
    const args = rest
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    const reply = await cmd.handler(args, ctx);
    return { handled: true, reply };
  }

  return {
    commands,
    whois,
    pause,
    resume,
    good,
    bad,
    weights,
    dataset,
    learn,
    distill,
    isAdmin,
    normalizeId,
    handle,
  };
}