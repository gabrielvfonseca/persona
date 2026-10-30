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

  const commands: Command[] = [whois, pause, resume];

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
  ): Promise<{ handled: boolean; reply?: string | undefined }> {
    const trimmed = text.trim();
    const cmd = commands.find((c) => trimmed === c.name);
    if (!cmd) return { handled: false };

    if (cmd.admin && !isAdmin(participant)) {
      return { handled: false };
    }

    const args = trimmed
      .slice(cmd.name.length)
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    const reply = await cmd.handler(args);
    return { handled: true, reply };
  }

  return { commands, whois, pause, resume, isAdmin, normalizeId, handle };
}
