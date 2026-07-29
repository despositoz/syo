# SYO assistant backend

The Mini App never talks to a model provider. It talks to this endpoint, and
this endpoint holds the only copy of the provider key.

```
Browser ──POST /api/assistant──▶ SYO backend ──▶ model provider
        (Telegram initData)      (verifies, prompts, sanitises)
```

## What it guarantees

| Guarantee                                                  | Where                                                                 |
| ---------------------------------------------------------- | --------------------------------------------------------------------- |
| The provider key never reaches the client                  | `assistant/provider.ts` — read from `process.env`, never returned     |
| No request is served without a verified Telegram signature | `assistant/verifyInitData.ts`, called first in `assistant/handler.ts` |
| Prompts live on the server and are versioned               | `assistant/prompts.ts`, `PROMPT_VERSIONS`                             |
| No review text, answer or model output is ever logged      | `assistant/handler.ts` — logs carry ids, operation, duration only     |
| The provider's own error text never reaches the user       | `assistant/provider.ts` throws `ProviderError(status)` with no body   |
| An empty model answer never replaces the user's words      | `handler.ts` returns 422 `contentRejected`                            |
| Per-user rate limit                                        | `handler.ts`, `ASSISTANT_RATE_LIMIT`                                  |

Tests: `server/assistant/handler.test.ts` (15 cases, run by `npm test` with the
rest of the suite). They cover forged and tampered initData, expiry, rate
limits, empty answers, provider failures, and that neither the key nor the text
appears in a log line or a response.

## Environment variables

| Name                       | Required | Meaning                                                                                                |
| -------------------------- | -------- | ------------------------------------------------------------------------------------------------------ |
| `TELEGRAM_BOT_TOKEN`       | yes      | Verifies initData. The same token as the bot serving the Mini App.                                     |
| `ASSISTANT_API_KEY`        | yes      | Model provider key. Server only — never `VITE_*`.                                                      |
| `ASSISTANT_MODEL`          | no       | Defaults to `claude-sonnet-5`.                                                                         |
| `ASSISTANT_RATE_LIMIT`     | no       | Requests per user per minute. Default 20.                                                              |
| `ASSISTANT_ALLOWED_ORIGIN` | no       | The Mini App origin, e.g. `https://despositoz.github.io`. Without it, no CORS headers are sent at all. |

On the client, only the endpoint URL is configured:

```
VITE_ASSISTANT_ENDPOINT=https://syo-assistant.example.workers.dev/api/assistant
```

That is a URL, not a secret. **Nothing else about the assistant may appear in a
`VITE_` variable** — everything prefixed `VITE_` is compiled into the public
bundle.

## Deploying

The handler takes a web-standard `Request` and returns a `Response`, so it runs
unchanged on every platform below. `server/api/assistant.ts` is the adapter.

### Cloudflare Workers (recommended — free tier is enough)

```bash
npm create cloudflare@latest syo-assistant
# copy server/assistant/* and server/api/assistant.ts into the worker's src/
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put ASSISTANT_API_KEY
npx wrangler deploy
```

In a Worker, replace `process.env` in `api/assistant.ts` with the `env` argument
of `fetch(request, env)` — the handler itself takes its configuration as a plain
object and needs no change.

### Vercel

Put `server/api/assistant.ts` at `api/assistant.ts` in a Vercel project, add the
two secrets in Project → Settings → Environment Variables, and deploy. The
`config = { runtime: 'edge' }` export at the bottom of the file is already what
Vercel expects.

### A plain Node server

```ts
import { createServer } from 'node:http';
import handler from './server/api/assistant';
// Node 18+: use a Request/Response adapter such as @remix-run/node or Hono.
```

## Checklist before going live

- [ ] `ASSISTANT_API_KEY` is set as a **secret**, not as a plain environment
      variable in a public dashboard, and never committed.
- [ ] `grep -r "VITE_ASSISTANT" dist/` returns only the endpoint URL.
- [ ] The endpoint is HTTPS and `ASSISTANT_ALLOWED_ORIGIN` names the Mini App.
- [ ] Rate limit is set for the instance count you actually run (the built-in
      limiter is per instance; behind several instances use a shared store).
- [ ] Logs are checked once after the first real request, to confirm they hold
      no text.
