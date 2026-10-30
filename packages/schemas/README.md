# @persona/schemas

Zod schema for persona files.

```ts
import { parsePersona } from "@persona/schemas";
const persona = parsePersona(JSON.parse(file));
```

`parsePersona` also accepts the legacy `{ profile: {...} }` shape.
