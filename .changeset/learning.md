---
"@persona/core": patch
"@persona/memory": patch
"@persona/policy": patch
"@persona/persona": minor
"@persona/learning": minor
---

Continuous learning: outcomes, feedback, weight tuning, persona patches, fine-tune dataset

- New `@persona/learning` package with `LearningEngine`, `LearningSystem`, and the
  `LearningObserver`/`FeedbackSink` ports on `@persona/core`.
- `createPersona` now accepts `learning`, `weights`, `onPatch`, `setPromptWeights`,
  `setRecallWeights`. The system prompt is a getter so the engine can swap it at
  runtime; `applyPatch` merges facts/phrases/style-guide into the persona.
- `@persona/memory` gains `setRecallWeights`, `fuseWeighted`, and
  `weightedReciprocalRankFusion` so the engine can tune keyword vs semantic recall.
- `@persona/policy` gains `!good`, `!bad`, `!weights`, `!dataset`, `!learn`,
  `!distill` admin commands and a `ctx` argument on `CommandHandler`.
