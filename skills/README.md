# Skills

Task guides for working on this repo. Each folder holds one `SKILL.md` with a
frontmatter `name` and `description`, a `modules` list pointing at the source
files it documents, and an `## Exports` list. `tests/contract/skills.test.ts`
checks that every exported name really exists in those modules, so a rename in
the code fails the test until the skill is updated.

| Skill | Use it when |
|---|---|
| [persona](persona/SKILL.md) | You need the project map, the reply pipeline, or where to start. |
| [persona-sdk](persona-sdk/SKILL.md) | You build or change a bot with `createPersona` or `createPersonaBot`. |
| [persona-memory](persona-memory/SKILL.md) | You touch history, recall, search, dedupe or rate limits. |
| [persona-policy](persona-policy/SKILL.md) | You decide when the bot replies, or add or change admin commands. |
| [persona-learning](persona-learning/SKILL.md) | You work on outcomes, ratings, weight tuning, distillation or the dataset. |
| [persona-schemas](persona-schemas/SKILL.md) | You read or write the persona file format. |
| [persona-whatsapp](persona-whatsapp/SKILL.md) | You connect a transport: Cloud API webhook or linked device (Baileys). |
| [persona-example-bot](persona-example-bot/SKILL.md) | You configure, run, or deploy `examples/bot`. |
| [persona-testing](persona-testing/SKILL.md) | You run, add or triage tests, or check docs against code. |

Start with `persona`. It links to the rest.
