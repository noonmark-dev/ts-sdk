# @noonmark/sdk

Client for a Noonmark Form: read its definition, send Submissions. No dependencies,
only `fetch`. Works in Node 18+, browsers, and edge runtimes. Ships ESM and CommonJS
with types.

## Install

```bash
npm i @noonmark/sdk
```

## Quick start

```ts
import { Noonmark, NoonmarkError } from "@noonmark/sdk";

const noonmark = new Noonmark({
  apiKey: process.env.NOONMARK_API_KEY!, // frm_...
  baseUrl: "https://noonmark.dev", // defaults to http://localhost:3000
});

try {
  const { id } = await noonmark.submit(
    { email: "ana@acme.com", message: "Export ignores the filter", rating: 4 },
    { idempotencyKey: "order-1234" }, // optional: makes a retry safe
  );
} catch (error) {
  if (error instanceof NoonmarkError && error.status === 429) {
    // wait error.retryAfter seconds
  }
}

// Read the Form definition (useful for kind: "survey"):
const { name, kind, fields } = await noonmark.form();
```

CommonJS works too: `const { Noonmark } = require("@noonmark/sdk")`.

### API

| Member | What it does |
| --- | --- |
| `new Noonmark({ apiKey, baseUrl? })` | Throws if `apiKey` is blank. |
| `submit(payload, { idempotencyKey?, turnstileToken? })` | `POST /api/v1/submit`. Resolves `{ ok: true, id }` or throws `NoonmarkError`. |
| `form()` | `GET /api/v1/form`. Resolves the `FormDefinition`. |
| `NoonmarkError` | `status`, `body`, and `retryAfter` (seconds, on a 429). |

`idempotencyKey` is sent as `Idempotency-Key`; the same key on the same Form resolves
with the first Submission's id. `turnstileToken` is sent as `X-Noonmark-Turnstile`
and works once.

Full guide: <https://noonmark.dev/docs/sdk>

## Development

```bash
npm ci
npm run typecheck && npm run build && npm test && npm run smoke
```

## Publishing

Maintainers: see [docs/publishing.md](docs/publishing.md). In short,
`npm run release -- patch`, then push the branch and the `v<version>` tag it prints.

## License

MIT
