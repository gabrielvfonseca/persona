# @persona/training

Learns a persona from a WhatsApp chat export.

```ts
import { listSenders, parseExport, trainFromExport } from "@persona/training";

listSenders(parseExport(raw)); // who to learn from
const persona = trainFromExport(raw, { sender: "Ana" });
```

Reads iOS and Android exports. Dates are parsed explicitly; export strings never go
through `new Date()`.
