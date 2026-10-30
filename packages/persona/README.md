# @persona/persona

The main SDK. Give it a persona, a model and a channel; it returns a bot.

```ts
import { createPersona } from "@persona/persona";

const bot = createPersona({ persona, channel, generator, admins: ["5511..."] });
const result = await bot.handle({ id, chatId, text });
```

`handle()` never throws. See [docs/PACKAGES.md](../../docs/PACKAGES.md) for every option,
and [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) for the pipeline.
