---
name: persona-learning
description: Work on @persona/learning, the continuous learning loop that records reply outcomes and admin ratings, nudges prompt and recall weights within clamped ranges, distills facts, phrases and style-guide lines into a persona patch, persists state, and drains a fine-tune dataset. Use when you change how the bot improves itself.
modules:
  - packages/learning/src/index.ts
---

# persona-learning

Learning is off unless you wire a `LearningSystem` into `createPersona`. The
`LEARNING_*` environment variables only take effect once the example app does
that wiring; see [persona-example-bot](../persona-example-bot/SKILL.md).

## Pieces

| Piece | Job |
|---|---|
| `LearningEngine` | In-memory weight math. `ingestOutcome`, `ingestFeedback`, `distill`, `drainDataset`. |
| `LearningSystem` | Glue. It is the `LearningObserver` the pipeline calls, the rating sink, and the saver. |
| `LearningStore` | Your storage: `get(key)` and `set(key, value)` with JSON strings. Key is `learning:state`. |
| `noopLearningObserver`, `noopFeedbackSink` | Do-nothing versions for when learning is off. |

```ts
import { LearningEngine, LearningSystem, defaultLearningState } from "@persona/learning";

const system = await LearningSystem.create({
  store,                                   // LearningStore
  engine: new LearningEngine(defaultLearningState(), {
    warmup: 5,          // samples before weights move
    step: 0.5,          // nudge size
    distillEvery: 20,   // distill every N outcomes
    maxPatchSize: 5,    // facts and phrases per patch
  }),
  onPatch: (patch) => bot.applyPatch(patch),
});

const bot = createPersona({ persona, channel, generator, learning: system });
await system.addRating("", chatId, +1, "nice");   // admin !good (comment optional)
```

`LearningSystem.create` loads the saved state, or defaults if it is missing or corrupt.
Older saved states are merged over the defaults, so new fields get default values.

## What counts as a signal

The pipeline calls `recordOutcome` only for replies and failures:

| Result | Signal | Effect |
|---|---|---|
| `replied` | +1 | Weights nudged up. The outcome is kept for distillation and the dataset. |
| `failed` | -1 | Weights nudged down. |
| `skipped`, `command` | not reported | No effect. |

Admin ratings (`addRating`) are +1 for good and -1 for bad, and count toward `goodCount` and `badCount`.

## Weight adjustment

Once `feedbackCount + goodCount + badCount` reaches `warmup`, each signal moves:

- `prompt.maxWords` by `step`, clamped to 1..40 and rounded to whole words.
- `prompt.exampleBoost` and `prompt.styleGuideStrength` by `step * 0.5`, clamped to 0.5..3.
- `recall.semanticWeight` by `step`, clamped to 0.1..5.
- `recall.keywordWeight` by `-step * 0.5`, clamped to 0.1..5.

Wire the new values into the live bot with `bot.setPromptWeights(...)` and
`bot.setRecallWeights(...)`. `LearningSystem` does not do that for you.

## Distillation

`distill()` builds a `PersonaPatch` from the pending replied outcomes, then calls
`onPatch` and saves state:

- A reply to a message containing "who are you" becomes a fact:
  `Answers "who are you" with: <reply>`.
- Other replies up to 40 characters, with no newline, become phrases.
- When more than half of all ratings are bad, the patch adds a concision style guide.

Distillation also runs by itself every `distillEvery` outcomes, in the background.

## Dataset

`drainDataset()` returns one `DatasetEntry` per replied outcome:
`{ messages, system, completion, chatId, timestamp, historyTurns }`. `messages`
is the history plus the user turn, which is the input the model saw. `completion`
is the reply. Draining clears the pending outcomes.

## Gotchas

- `LearningSystem.create` restores the saved state into the engine. Pass `engineOptions` to tune
  the engine. A pre-built `engine` must already hold the state you want, or it starts from defaults.
- Pending outcomes are capped (`maxPending`, default 1000). The oldest are dropped if they are not
  drained. The distillation cadence counts weight-moving outcomes separately, so the cap does not stop it.
- Ratings keep the newest `maxRatings` (default 50) in `state.ratings`, with their comments.
- The library does not push weights to a live bot. `examples/bot/src/learning.ts` does, after every
  outcome and rating, and it saves the state every 10 outcomes and on every rating and distillation.
  A crash can lose up to 9 outcome updates.
- `recordOutcome` must not throw. The pipeline fires it and does not await it.

## Exports

- `LearningEngine`
- `LearningSystem`
- `noopLearningObserver`
- `noopFeedbackSink`
- `defaultLearningState`
- `applyPatch`
- `loadLearningState`
- `saveLearningState`
- `mergeLearningState`
- `outcomeSignal`
- `wasReplied`
- `wasFailed`

## Related

- Wiring into the pipeline: [persona-sdk](../persona-sdk/SKILL.md)
- Rating commands: [persona-policy](../persona-policy/SKILL.md)
- Storing state in KV: `@persona/postgres`
- Tests: `tests/integration/learning-loop.test.ts`, `tests/unit/pure-functions.test.ts`, `packages/learning/tests/`
