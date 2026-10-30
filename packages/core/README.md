# @persona/core

Shared ports and types for the persona SDK. Contains no runtime code, so every other
package can depend on it safely.

Exports: `Turn`, `IncomingMessage`, `Channel`, `HistoryStore`, `DedupeStore`,
`RateLimiter`, `BotState`, `ReplyGenerator`, `ImageDescriber`, `Logger`,
`MessageHandler`, `HandleResult`.

To build a bot, use `@persona/persona`. See [docs/PACKAGES.md](../../docs/PACKAGES.md).
