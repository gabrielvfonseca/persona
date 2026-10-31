---
name: persona-policy
description: Decide when the persona replies (direct and group triggers, name and mention matching, allowlisted groups, optional unprompted replies) and add or change admin and public commands (!whois, !pause, !resume, !good, !bad, !weights, !dataset, !learn, !distill). Use when touching who gets an answer or how commands behave.
modules:
  - packages/policy/src/index.ts
---

# persona-policy

`@persona/policy` has two parts: the reply policy, which decides whether to
answer a message, and the command table, which handles `!` commands.

## Reply policy

```ts
import { createReplyPolicy, mentionsName } from "@persona/policy";

const policy = createReplyPolicy({
  direct: "always",            // 1:1 chats: always | addressed | never
  group: "addressed",          // groups: default addressed
  names: ["Ana"],              // matched on word boundaries, case-insensitive
  allowedGroups: ["g1@g.us"],  // when set, every other group is a hard "never"
  unpromptedProbability: 0,    // chance to reply to unaddressed messages
  random: Math.random,
});

policy.shouldReply({ isGroup, chatId, text, mentioned });  // "always" | "addressed" | "never"
```

Decision order:

1. Group not in a non-empty `allowedGroups`: `never`, even when mentioned.
2. Trigger for the chat type is `always`, or the message names the persona or
   mentions the bot: `always`.
3. Otherwise, `always` with probability `unpromptedProbability`, else `never`.

The pipeline treats `"always"` as reply and `"never"` as skip (`not-addressed`).

`mentionsName("Hey Ana, ...", "Ana")` is true. `"Banana"` is not, because the
match must sit on word boundaries. A leading `@` is allowed.

## Admin and public commands

```ts
import { createCommands } from "@persona/policy";

const commands = createCommands({
  adminNumbers: ["5511999999999"],
  botName: "Ana",
  state,                      // BotState with setPaused
  onRate: (chatId, rating, comment) => {},
  onWeights: () => "...",
  onDataset: () => "...",
  onDistill: async () => "...",
});
```

| Command | Who | What it does |
|---|---|---|
| `!whois` | anyone | Says who the bot is. |
| `!pause` / `!resume` | admins | Sets the pause flag. |
| `!good` | admins | Rates the last reply +1 through `onRate`. |
| `!bad [comment]` | admins | Rates the last reply -1 with an optional comment. |
| `!weights` | admins | Returns the learning weights through `onWeights`. |
| `!dataset` | admins | Returns the fine-tune dataset export through `onDataset`. |
| `!learn <fact>` | admins | Intended to add a fact. **Currently replies "Learned." and stores nothing.** |
| `!distill` | admins | Runs distillation through `onDistill`. |

How matching works:

- A command matches when the trimmed text equals its name or starts with `name `.
- Admin commands check `isAdmin(participant)`: the user part of the id, before
  `@` and `:`, must be in `adminNumbers`.
- A non-admin sending an admin command is **not** rejected. The command is not
  handled, so the text goes through the normal policy and may get a model reply.
  Do not rely on admin commands for secrecy.
- Without a callback, `!good`, `!bad`, `!weights`, `!dataset` and `!distill`
  reply "Learning is not enabled."

## Adding a command

1. Add a `Command` object (`name`, `description`, `admin`, `handler`) to the list in `commands.ts`.
2. Give the handler the `args` array and `ctx.chatId`. Return a string to reply, or `undefined` for silence.
3. Cover the admin and non-admin paths in `packages/policy/tests/commands.test.ts`.

## Known issue

`!learn` claims success without storing anything, because `CommandsOptions` has no
hook for it. The reproduction is `packages/policy/tests/known-issues.test.ts`. Fix
it by adding an `onLearn` callback and wiring it to `memory.learn` or the persona.

## Exports

- `createReplyPolicy`
- `mentionsName`
- `createCommands`

## Related

- Where the policy runs: [persona-sdk](../persona-sdk/SKILL.md)
- Learning callbacks: [persona-learning](../persona-learning/SKILL.md)
- Tests: `tests/unit/pure-functions.test.ts`, `tests/integration/persona-pipeline.test.ts`, `packages/policy/tests/`
