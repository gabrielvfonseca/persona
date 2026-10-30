# Owner TODO

Items that need a person, not code.

- **Rotate the OpenRouter key** that was committed to git earlier.
- **Remove the chat exports from git.** `training/01_chat.txt`, `02_chat.txt` and
  `03_chat.txt` are tracked. Run `git rm --cached training/*.txt` and, if you want them
  gone from history too, purge them. Only `data/.gitkeep` and `data/persona.example.json`
  should be tracked.
- **Decide on linked-device sessions on Workers.** `WhatsAppConnection` only answers
  `/status`. Either finish the Baileys Durable Object or remove the `/cf-bot/*` proxy.
- **Confirm the Meta webhook** verify token matches `WHATSAPP_VERIFY_TOKEN`.
- **Re-add the private persona fields** (`styleGuide`, `phrases`, `facts`) to
  `examples/persona/data/persona.json` if you rebuild it with `ingest`. The ingest script
  keeps them when the file already exists, but a fresh checkout does not have them.
- **Set the `PERSONA_JSON` secret** for the Worker before the first deploy.
- **Worker recall is limited.** History is stored in KV, not in the node store, so semantic
  and keyword recall on the Worker only see knowledge learned in the same isolate. Persist
  nodes in KV (or Vectorize) before relying on recall there.
- **Decide the group allowlist behavior.** `allowedGroups` is now a hard deny, even when
  the bot is mentioned. Check that matches what you want.
