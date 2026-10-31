---
name: persona-schemas
description: Read, write and validate the persona file format (personaV1) in @persona/schemas, including the legacy { profile } shape. Use when you create or edit data/persona.json, change the schema, or debug a persona that fails to load.
modules:
  - packages/schemas/src/index.ts
---

# persona-schemas

A persona file is JSON that describes who the bot imitates. `@persona/schemas`
defines it with zod and parses it with `parsePersona`.

## Format (version 1)

```json
{
  "version": 1,
  "name": "Ana",
  "styleGuide": "Short, warm and casual. Lowercase is fine.",
  "languageHint": "pt-BR",
  "stats": { "medianLen": 18, "p90Len": 52, "messageCount": 1200 },
  "quotes": ["haha sim, bora", "amanhã eu te falo"],
  "phrases": ["bora", "kkkk"],
  "facts": ["Lives in São Paulo.", "Likes coffee in the morning."],
  "exchanges": [{ "user": "vamos hoje?", "assistant": "bora, 19h" }]
}
```

| Field | Required | Notes |
|---|---|---|
| `version` | yes | Literal `1`. |
| `name` | yes | Used in the prompt and for name matching. |
| `styleGuide` | yes | Free text. Can be empty. |
| `languageHint` | no | Added to the prompt as `Language: ...`. |
| `stats` | yes | `medianLen`, `p90Len` numbers, and optional `messageCount`. |
| `quotes` | yes | Short sample lines. The prompt uses up to 8, at most 80 characters each. |
| `phrases` | yes | Recurring phrases. |
| `facts` | yes | Facts the bot may state about itself. |
| `exchanges` | no | Real `{ user, assistant }` pairs. The prompt uses up to 6, at most 160 characters each. |

## Parsing

```ts
import { parsePersona, personaV1 } from "@persona/schemas";

const persona = parsePersona(JSON.parse(text)); // throws a zod error when invalid
```

`parsePersona` also accepts the legacy shape `{ "profile": { ... } }`. Missing
fields get defaults: `name` becomes `"Bot"`, the lists become `[]`, and `stats`
becomes zeros. Anything else must match `personaV1`.

## Where the file is used

- The example app reads `PERSONA_FILE` (default `data/persona.json`) with `loadPersona`.
- The Worker reads the whole file from the `PERSONA_JSON` secret.
- `examples/bot/data/persona.example.json` is a valid example. Tests load it.

## Creating a persona file

The ingest step that once built a file from a chat export has been removed, and
`README.md`, `DEPLOY.md` and `docs/API.md` still describe it. Until it returns,
write the file by hand, starting from `persona.example.json`. Only use real
messages from someone who has consented.

## Gotchas

- `version` must be the number `1`, not the string `"1"`.
- `exchanges` is optional, but a quote or exchange is dropped from the prompt if it is over its length cap.
- Quotes that look like system text (`end-to-end`, or a zero-width mark) are dropped from the prompt.
- Nothing writes back to the file. `applyPatch` and learning changes live only in memory and are lost on restart unless you save them yourself.

## Exports

- `parsePersona`
- `personaV1`

Types: `Persona`, `Exchange`.

## Related

- How the prompt is built: [persona-sdk](../persona-sdk/SKILL.md)
- Loading in the app: [persona-example-bot](../persona-example-bot/SKILL.md)
- Tests: `tests/unit/example-config.test.ts`, `packages/schemas/tests/`
