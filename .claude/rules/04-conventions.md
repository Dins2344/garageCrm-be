<!-- Detailed reference for this repository, split by topic and read on demand.
     The always-on rules live in CLAUDE.md at the repo root. -->

## No Emoji — Plain Text Only

The backend produces plain text: SMS bodies, email subjects and bodies, PDF
content, log lines, script output, and CI messages. None of them may contain
emoji.

`[emoji]` below stands in for a literal emoji character — this file stays free
of them so a repo-wide scan finds zero hits.

```typescript
// Don't
const body = `Hi ${customerName}! [emoji]\n\nYour ${make} is due for a service.`;
const subject = `[emoji] ${serviceLabel} Reminder — ${plate}`;
console.log('No ownerless garages found. [emoji]');
log.info('[emoji] Server started');

// Do
const body = `Hi ${customerName},\n\nYour ${make} is due for a service.`;
const subject = `${serviceLabel} Reminder — ${plate}`;
console.log('No ownerless garages found.');
log.info('Server started');
```

**This is not cosmetic — each channel breaks differently:**

- **SMS**: one emoji switches the message from GSM-7 to UCS-2, cutting the
  segment size from 160 to 70 characters. A reminder that fit in one segment
  now costs two.
- **PDF**: PDFKit's built-in Helvetica has no glyph for them. This is the same
  constraint that forces `currencyDisplay: 'code'` in `utils/format.ts` — an
  emoji renders as a blank box.
- **Logs**: Winston output goes to files and CI consoles that mangle
  multi-byte characters, making `grep` unreliable.
- **Email**: plain-text alternatives and older clients render them as `?`.

Where a glyph carried meaning in text output, use the **word**: `RIGHT` /
`WRONG`, `Done`, `OK` / `FAIL`. Deleting the glyph and leaving the sentence
bare loses the information.

This applies to `scripts/`, `.github/workflows/`, the docs in `.claude/rules/`, and commit
messages as well as runtime code.

---

## Code Style

### Module System
- **TypeScript compiled to CommonJS** (`tsconfig.json`: `module: Node16`) — write `import`/`export` syntax, it compiles to `require`/`module.exports`, matching the runtime the project has always used
- Use named exports (`export const functionName = ...`) for multiple functions from controllers/usecases — mirrors the old `exports.functionName` convention
- Use `export default` for a single entity (models, middleware, the Express app)

### Formatting
- 2 spaces for indentation
- Single quotes for strings
- Semicolons at end of statements
- Trailing commas in multi-line objects/arrays
- Blank line between logical sections (imports, setup, functions)

### Imports — Ordering
```typescript
// 1. Node.js built-in modules
import path from 'path';

// 2. Third-party packages
import express from 'express';

// 3. Internal modules — config first, then models, usecases, middleware, utils
import connectDB from './config/db';
import Customer from '../models/Customer';
import * as customerUsecase from '../usecases/customerUsecase';
import { protect, authorize } from '../middleware/auth';
import logger from '../utils/logger';
```

---

## TypeScript Conventions

The whole backend is TypeScript (`strict: true` in `tsconfig.json`). No new `.js` files — everything is `.ts`.

### Rules
- **Colocate types with their model.** A model's `Document`-extending interface (`IUser`, `ICustomer`, ...) lives in the same file as its schema, not in `types/`.
- **Shared domain enums live in `types/domain.ts`.** `Role`, `JobStatus`, `ServiceType`, `PaymentStatus`, etc. are each a `const array + derived union type` (see the file for the pattern) — reuse them instead of re-typing string literals in a new usecase/model. These must stay in sync with the enum lists in `.claude/rules/00-shared-contract.md` and with both client repos' `types/models.ts`.
- **`req.user` / `req.admin` typing** lives in `types/express.d.ts`, which augments `Express.Request` globally. Don't redeclare `req.user`'s shape locally — import `AuthenticatedUser` from `types/express` if you need to reference the type directly.
- **Errors:** throw `HttpError` from `utils/httpError.ts` (see Error Handling above) instead of a plain `Error` with a bolted-on `.statusCode`.
- **Avoid `any`.** It's acceptable at genuine third-party boundaries where a library's types don't line up with reality (a couple of PDF/email service spots do this deliberately, with a comment) — it is not acceptable as a shortcut past a real typing problem in our own code.
- **`req.params.<name>` is `string | string[]`** under Express 5's types (path-to-regexp supports repeating params now). Cast explicitly: `const id = req.params.id as string;`.
- Mongoose query filter type is `QueryFilter<T>` in this Mongoose version (**not** `FilterQuery<T>` — that name was renamed upstream; don't reintroduce the old import).
- Run `npm run typecheck` (`tsc --noEmit`) before pushing — it's also enforced in CI (`.github/workflows/ci.yml`).

---

## Testing Conventions

Tests use **Vitest** + **Supertest** + **mongodb-memory-server** — a real (ephemeral, local, free) MongoDB instance per test run, not mocks of Mongoose itself. This means tests exercise the actual `garage`-scoping queries, schema validators, and indexes, not a fake approximation of them.

### Where tests live
- `tests/*.test.ts` — one file per feature area, not necessarily one per usecase (e.g. `tests/jobCardAndInvoice.test.ts` covers both since invoice generation depends on job card estimation state)
- `tests/setup.ts` — global setup: starts `mongodb-memory-server`, connects Mongoose, clears all collections after every test, and mocks `services/emailService.ts` + `services/smsService.ts` so no test ever contacts a real SMTP/Twilio provider
- `tests/helpers/` — shared fixtures (e.g. `factories.ts` for registering a garage + owner through the real `/api/auth/register` endpoint)

### Rules
- **Hit real routes through `app` (from `app.ts`), not `server.ts`.** `import app from '../app'; import request from 'supertest';` — never import `server.ts` in a test, it calls `app.listen()` and starts the cron scheduler.
- **Tenant-isolation tests are mandatory** for any new tenant-scoped entity: prove that Garage B gets a 404 (not the data) when trying to read/update/delete a resource that belongs to Garage A. See `tests/tenantIsolation.test.ts` for the pattern.
- **Every new/changed usecase should ship with at least one happy-path and one error-path test.** Not full line-coverage — the priority order is auth, tenant isolation, and billing/invoice math, since those are the areas where a silent bug is expensive.
- Fixture setup shared across multiple `it()` blocks in the same `describe` must use `beforeEach`, not `beforeAll` — the global `afterEach` in `tests/setup.ts` wipes all collections after every single test, so a `beforeAll` fixture only survives the first test in the block.
- Use unique emails/phone numbers per test (see `nextPhone()` in `tests/helpers/factories.ts`) rather than relying on cleanup ordering.
- Test emails need a real-looking TLD 2-3 characters long (`@example.com`, not `@test.local`) — the `User` model's email regex requires it; this is a real constraint on registered users, not a test-only quirk.

### Running tests
```bash
npm test          # single run (vitest run) — what CI runs
npm run test:watch # watch mode while developing
```

## Environment Variables

All environment variables MUST be documented in `.env.production.example`:

```bash
# Required
NODE_ENV=production
PORT=5000
MONGODB_URI=mongodb+srv://...
JWT_SECRET=your_jwt_secret
CLIENT_URL=https://yourdomain.com

# Optional — Notification Services
SMTP_HOST=smtp.gmail.com
SMTP_USER=your@email.com
SMTP_PASS=your_app_password
TWILIO_SID=...
TWILIO_TOKEN=...
TWILIO_PHONE=...
```

### Rules:
- Never commit `.env` files
- Always update `.env.production.example` when adding new env vars
- Use `process.env.VAR_NAME` with sensible fallbacks where appropriate
- Validate critical env vars at startup (fail fast if missing)

---

## Pre-Push Checklist

Before pushing code, verify:

- [ ] No emoji in SMS/email bodies, PDF content, log lines, or script output
- [ ] Dependencies installed under Node 20 / npm 10 (`nvm use`) — verify with `npx -y npm@10 ci --dry-run`
- [ ] No `console.log` — use the `logger` utility instead
- [ ] All routes are wrapped in `asyncHandler()`
- [ ] All queries are scoped to `garageId` (unless admin)
- [ ] Error handling follows the `throw new HttpError(message, statusCode)` pattern
- [ ] New models include `timestamps: true` and `garage` field, and export their `Document` interface
- [ ] New routes are registered in `app.ts`
- [ ] New/changed endpoints are documented in `config/swaggerDocs.ts`, and changed models/request shapes updated in `config/swagger.ts` — verify with `npx tsx scripts/checkSwagger.ts`
- [ ] Logging includes structured metadata (not string interpolation)
- [ ] `.env.production.example` is updated if new env vars are added
- [ ] No hardcoded secrets, URLs, or credentials
- [ ] `npm run typecheck` passes with zero errors
- [ ] New or changed usecases have at least one happy-path and one error-path test; new tenant-scoped entities have a tenant-isolation test
- [ ] `npm test` passes locally
