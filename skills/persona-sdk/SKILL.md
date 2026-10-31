---
name: persona-sdk
description: Build, configure and change a persona bot with the @persona/persona SDK, using createPersona for the one-call setup or createPersonaBot for full control of the pipeline. Covers options, defaults, the system prompt, reply transforms and guards, and runtime updates.
modules:
  - packages/persona/src/index.ts
---

# persona-sdk

`@persona/persona` turns a persona, a reply generator and a channel into a bot.
Use `createPersona` unless you need to replace parts of the pipeline.

## Minimal bot

```ts
import { createPersona } from "@persona/persona";
import { parsePersona } from "@persona/schemas";

const bot = createPersona({
  persona: parsePersona(personaJson),
  channel,      // { name, send(chatId, text, replyTo?) }
  generator,    // { generate(system, turns) }
  admins: ["5511999999999"],
});

const result = await bot.handle({ id: "msg-1", chatId: "chat-1", text: "hi Ana" });
```

`channel` and `generator` are ports from `@persona/core`. Any transport or model
adapter that matches the shape works. See [persona-whatsapp](../persona-whatsapp/SKILL.md)
for transports and [persona-example-bot](../persona-example-bot/SKILL.md) for an
a model generator (the bot example passes a local ggml-node model).

## createPersona options

| Option | Default | Notes |
|---|---|---|
| `persona` | required | A parsed `Persona`. `applyPatch` mutates its `facts`, `phrases` and `styleGuide`. |
| `channel` | required | Where replies go. |
| `generator` | required | Produces reply text. Called with the system prompt and the turns. |
| `describer` | none | Turns images and stickers into text for the prompt. |
| `logger` | `console` for warnings and errors | `info`, `warn`, `error`. |
| `admins` | `[]` | Ids allowed to run admin commands. |
| `policy` | `{ direct: "addressed", group: "addressed" }` | `direct` and `group` take `always`, `addressed` or `never`. Names come from `persona.name`. |
| `memory` | `createMemory()` | Replace it to persist history, dedupe, rate limits or state. |
| `recallLimit` | `0` | Past messages and knowledge added to the system prompt. `0` turns recall off. |
| `transforms` | `[stripSpeakerPrefix, firstSentence]` | Run in order on the model reply. Replaces the defaults. |
| `guards` | `[noEcho]` plus yours | Each returns `true` to allow the reply. |
| `prompt` | see below | Passed to `buildSystemPrompt`. |
| `learning` | none | A `LearningObserver`. See [persona-learning](../persona-learning/SKILL.md). |
| `commands` | none | Hooks for admin commands: `onRate`, `onWeights`, `onDataset`, `onDistill`, `onLearn`. `onLearn` defaults to adding the fact to the persona through `applyPatch`. |
| `weights` | `{ maxWords: 15, exampleBoost: 1, styleGuideStrength: 1, extraRules: [] }` | Live prompt weights. |
| `onPatch`, `setPromptWeights`, `setRecallWeights` | none | Callbacks fired when the bot changes its own settings. |

The returned object (`ConfiguredPersona`) adds `handle`, `state` (pause flag),
`memory`, a `systemPrompt` getter, and `applyPatch`, `setPromptWeights`,
`setRecallWeights`.

## The system prompt

`buildSystemPrompt(persona, options)` produces, in order: `You are <name>.`, the
style guide, the language hint, `Reply in at most N words.`, the AI admission
line, your extra rules, example quotes (up to 8, at most 80 characters each,
system-looking lines dropped), real exchanges (up to 6), phrases and facts.

- `maxWords` comes from `weights.maxWords` when `weights` is given. Otherwise it is
  `prompt.maxWords` (default 15). Runtime changes through `setPromptWeights` replace it.
- `admitBeingABot: false` drops the AI admission line.
- The prompt is a getter, so `applyPatch` and `setPromptWeights` take effect on
  the next message.

## Pipeline contract (`createPersonaBot`)

Use `createPersonaBot` when you need to pick every part yourself. Its options are
`channel`, `history`, `generator`, `policy`, `logger` (required), plus optional
`dedupe`, `rateLimiter`, `state`, `describer`, `commands`, `systemPrompt`
(string or getter), `transforms`, `guards`, `examples`, `recall`, `learning`.

Behavior you can rely on:

- `handle` never throws. Errors come back as `{ kind: "failed" }`.
- Dedupe key is `${channel.name}:${msg.id}`, kept for 5 minutes.
- Commands run before the pause check. Admin checks use `senderId`, falling back
  to `chatId`. In groups, set `senderId`.
- Group user turns are `"${senderName}: ${text}"`. Direct turns are the text alone.
- Media is appended as `[image: description]` or `[sticker: description]`. A
  describer failure becomes `[kind: unavailable]`.
- A transform can strip a speaker prefix (`Ana: ...`, up to 20 characters before the colon) and cut to the first sentence.
- A reply that is empty after transforms is `skipped: empty`. A reply that fails a guard is `skipped: guard`.
- History is written only after `send` succeeds. A failed history write is logged, not thrown.
- With `recall`, recalled lines are appended to the system prompt under
  `Earlier in this chat:`.

## Runtime changes

```ts
bot.setPromptWeights({ maxWords: 8, exampleBoost: 1, styleGuideStrength: 1, extraRules: [] });
bot.setRecallWeights({ keywordWeight: 1, semanticWeight: 1, rrfK: 60 });
bot.applyPatch({ facts: ["Works as a nurse"], phrases: ["bora"] });
bot.state.setPaused(true);
```

`applyPatch` de-duplicates facts and phrases case-insensitively and appends the
style guide. It then calls `onPatch`.

## Recipes

- Stop answering groups unless named: `policy: { direct: "always", group: "addressed" }`.
- Add a guard for banned words: `guards: [(s) => !/badword/i.test(s)]`.
- Keep a reply short without changing the persona: `setPromptWeights({ ...w, maxWords: 8 })`.

## Gotchas

- `createPersona` mutates `persona` on `applyPatch`. Pass a copy if the original must stay unchanged.
- Default `recallLimit` is `0`. The example app sets it from `RECALL_LIMIT`, which defaults to `4`.

## Types

`Persona`, `PersonaBot`, `PersonaBotOptions`, `ConfiguredPersona`, `PersonaOptions`,
`PromptOptions`, `ReplyGuard`, `ReplyTransform` (from `@persona/persona`), and the
ports `Channel`, `ReplyGenerator`, `HistoryStore`, `Turn`, `IncomingMessage`,
`HandleResult`, `PromptWeights`, `RecallWeights` (from `@persona/core`).

## Exports

- `createPersona`
- `createPersonaBot`
- `buildSystemPrompt`
- `stripSpeakerPrefix`
- `firstSentence`
- `noEcho`
- `notEmpty`

## Related

- Policy and commands: [persona-policy](../persona-policy/SKILL.md)
- Memory and recall: [persona-memory](../persona-memory/SKILL.md)
- Tests: `tests/persona-pipeline.test.ts` (root) and `packages/persona/tests/`
