---
name: persona-testing
description: Run, add and triage tests across the persona monorepo. Covers the root tests/ layout (helpers, unit, integration, contract), each package's own tests, the it.fails convention for known bugs, the skills and docs contract checks, and the typecheck and lint commands. Use before you change code, when a test fails, or when you add coverage.
modules: []
---

# persona-testing

The repo has two test layers. Each package and example owns its tests, and the
root `tests/` checks how the pieces fit together and how the docs and skills match the code.

## Layout

```
packages/<name>/tests/        package unit tests, run by turbo
examples/bot/tests/           example app tests
tests/
  helpers/                    shared fakes and fixtures (not test files)
  unit/                       pure functions and config, no bot wiring
  integration/                several packages together, with fakes at the edges
  contract/                   docs, env files, workspace layout and skills vs code
```

`vitest.config.ts` at the root maps `@persona/*` to the workspace sources, so
root tests run against the code you just changed, not built output.

## Commands

```bash
bun run test                         # every package and the example (turbo)
bunx vitest run                      # root tests/ only
bunx vitest run tests/integration    # one folder
bun run check                        # biome across workspaces
bun run typecheck                    # per-package tsc
bun run --cwd examples/bot test      # one example's tests
```

Run a single file with `bunx vitest run <path>` from the package directory, or from the root for root tests.

## Helpers (`tests/helpers/fakes.ts`)

| Helper | Use it for |
|---|---|
| `persona()` | A fresh, validated copy of `examples/bot/data/persona.example.json`. |
| `fakeChannel({ fail })` | Records sends, or throws to simulate a transport failure. |
| `fakeGenerator(reply)` | A fixed reply or a function. Records each `{ system, messages }` call. |
| `fakeDescriber(text)` | Describes images and records the bytes it was given. |
| `memoryKv()` | A Map-backed KV with `data` and `puts` for assertions. |
| `memoryHistory()` | An in-process `HistoryStore`. |
| `sign(body, secret)` | The `X-Hub-Signature-256` value for a raw body. |
| `cloudPayload(messages, phoneId)`, `textMessage(id, from, body)` | Cloud API webhook bodies. |
| `silentLogger` | A logger that prints nothing. |

`tests/helpers/cloudflare-workers.ts` stubs the `cloudflare:workers` module so the Worker can be imported in Node.

## Adding a test

1. Put a pure function's test in `tests/unit/`. Use the real module, no fakes beyond inputs.
2. Put a flow across packages in `tests/integration/`. Use `createPersona` with `fakeChannel` and `fakeGenerator`. Stub the network at `fetch` or the model adapter, never inside the SDK.
3. Put a package-only behavior in `packages/<name>/tests/`.
4. Assert on observable results: `HandleResult` kinds, what the channel received, what KV holds. Avoid asserting internal state that a refactor could change.
5. Keep time, randomness and network out of the test. Inject `now`, `random`, and `fetch`.

## Known bugs: the `it.fails` convention

A known bug gets a test that expects the correct behavior and is marked `it.fails`.
The suite stays green while the bug exists. When someone fixes it, the test starts
failing, which is the signal to change `it.fails` to `it`.

| Bug | Where it is pinned |
|---|---|
| `createPersona` ignores `prompt.maxWords` | `packages/persona/tests/known-issues.test.ts` |
| `!learn` reports success without storing | `packages/policy/tests/known-issues.test.ts` |
| Linked-device disconnects are reported as logged out | `packages/whatsapp/tests/baileys/connect-reconnect.test.ts` |
| `bun run ingest` is documented but missing | `tests/contract/docs-cross-reference.test.ts` |

Confirm an `it.fails` really fails for the documented reason before you trust it.
Temporarily switch it to `it`, read the assertion, and switch it back.

## Contract checks

`tests/contract/` keeps the repo honest:

- `workspace-layout.test.ts`: `packages/*` and `examples/*` are workspaces, every SDK package is named `@persona/<dir>`, every package has tests and a test script, and `scripts/packages.ts` lists every SDK package.
- `docs-cross-reference.test.ts`: `.env.example`, `docs/DEPLOYMENT.md` and `src/config.ts` list the same keys. `ARCHITECTURE.md` and `PACKAGES.md` name only real packages. The dependency table matches `scripts/packages.ts`. README commands exist.
- `skills.test.ts`: every skill has the frontmatter fields, its `## Exports` names exist in its `modules`, and its relative links resolve.

When you rename an export, update the skill that lists it. The skills test will tell you which one.

## Triage

- A contract failure in docs is usually drift. Fix the doc, or the code if the doc is right.
- A pipeline failure with `kind: "failed"` often means a fake throws. Check `fakeChannel({ fail })` and the generator fixture.
- A Worker test that makes no graph call usually means `fetch` was captured before a spy was installed. `CloudApiClient` reads `fetch` in its constructor.
- A Cloud API bot that skips a DM is probably not addressed by name. Its `buildBot` policy is `addressed`.

## Exports

This skill documents tests, not runtime code, so it lists no exports.
