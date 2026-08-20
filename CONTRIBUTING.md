# GaragePulse Backend — Contributing & Code Standards

> **Last Updated:** August 2026
> **Stack:** Node.js · Express 5 · Mongoose 9 · TypeScript · Vitest · Winston · JWT

---

## Project Structure

```
backend/
├── config/           # App configuration (db.ts, swagger.ts)
├── controllers/      # Thin HTTP controllers (parse req → call usecase → send res)
├── usecases/         # Core business logic (pure functions, no HTTP knowledge)
├── models/           # Mongoose schemas & models (each exports its TS interface too)
├── routes/           # Express route definitions (verb + path + middleware)
├── middleware/        # Express middleware (auth, error handling, sanitization)
├── services/         # External integrations (email, SMS, PDF, cron)
├── utils/            # Shared utilities (logger, httpError)
├── types/            # Shared domain types (enums) + Express Request augmentation
├── tests/            # Vitest test suite (mirrors the layers above) + tests/helpers/
├── scripts/          # One-off or migration scripts
├── logs/             # Auto-generated log files (gitignored)
├── nginx/            # Nginx reverse proxy config
├── app.ts            # Express app construction (middleware, routes) — no side effects on import
├── server.ts         # Entrypoint: loads env, connects DB, starts app.listen() + services
├── dist/              # Compiled output (gitignored, produced by `npm run build`)
├── Dockerfile        # Production Docker image (multi-stage: tsc build → slim runtime)
└── docker-compose.yml
```

`app.ts`/`server.ts` are deliberately split: `app.ts` builds the Express app with no side effects on import, so it can be imported directly in tests (via `supertest`) without hitting a real database or starting cron jobs. `server.ts` is the only file that calls `connectDB()`, `initSms()`, `initTransport()`, `startScheduler()`, and `app.listen()`.

### Where Does New Code Go?

| You need to...                        | Put it in...       |
| ------------------------------------- | ------------------ |
| Define a new API endpoint             | `routes/`          |
| Parse HTTP request / send response    | `controllers/`     |
| Write business logic / data operations | `usecases/`        |
| Define a data schema                  | `models/`          |
| Add cross-cutting request logic       | `middleware/`       |
| Integrate with an external system     | `services/`        |
| Add a shared helper function          | `utils/`           |
| Add database or app configuration     | `config/`          |

---

## Architecture Rules

### Controller → Usecase → Model (Strict Layering)

1. **Controllers** are thin HTTP adapters. They:
   - Extract data from `req.params`, `req.query`, `req.body`, `req.user`
   - Call a **usecase** function
   - Send a standardized JSON response
   - **Never** import models directly
   - **Never** contain business logic (no if/else branching on business conditions)

2. **Usecases** contain all business logic. They:
   - Accept plain JavaScript objects as arguments (destructured)
   - Import and query **models** directly
   - Throw errors with `.statusCode` for HTTP-aware error handling
   - **Never** access `req`, `res`, or `next`
   - **Never** import controllers or routes

3. **Models** define data shapes and database indexes. They:
   - Use Mongoose schemas with proper validations
   - Define compound indexes for multi-tenant queries (`garage + field`)
   - **Never** contain business logic

```
WRONG   controller → model          (skips the usecase layer)
WRONG   usecase → req/res           (HTTP leaks into business logic)
RIGHT   controller → usecase → model
```

### Example — Adding a New Feature (e.g., "Suppliers")

```bash
# 1. Model (+ exported TS interface, e.g. ISupplier)
models/Supplier.ts

# 2. Usecase (business logic)
usecases/supplierUsecase.ts

# 3. Controller (HTTP thin wrapper)
controllers/supplierController.ts

# 4. Route (wire it up)
routes/suppliers.ts

# 5. Register in app.ts
import supplierRoutes from './routes/suppliers';
app.use('/api/suppliers', supplierRoutes);

# 6. Tests — at least one happy-path + one error-path
tests/supplier.test.ts
```

---

## Naming Conventions

### Files

| Layer       | Pattern                  | Example                    |
| ----------- | ------------------------ | -------------------------- |
| Model       | `PascalCase.ts`          | `Customer.ts`, `JobCard.ts` |
| Controller  | `camelCaseController.ts` | `customerController.ts`    |
| Usecase     | `camelCaseUsecase.ts`    | `customerUsecase.ts`       |
| Route       | `camelCase.ts` (plural)  | `customers.ts`, `jobCards.ts` |
| Middleware  | `camelCase.ts`           | `auth.ts`, `errorHandler.ts` |
| Service     | `camelCaseService.ts`    | `emailService.ts`          |
| Test        | `camelCase.test.ts` under `tests/` | `tests/jobCardAndInvoice.test.ts` |

`.js` files are no longer added anywhere in `backend/` — see **TypeScript Conventions** below.

### Functions

| Layer       | Convention                                          | Example                                |
| ----------- | --------------------------------------------------- | -------------------------------------- |
| Controller  | `exports.verbNoun`                                  | `exports.getCustomers`                 |
| Usecase     | `exports.descriptiveAction`                         | `exports.getCustomersList`             |
| Middleware  | Named function or `const name = (req, res, next) => {}` | `const protect = async (req, res, next) => {}` |

### Variables

- **camelCase** for variables and function names
- **PascalCase** for Mongoose model names
- **UPPER_SNAKE_CASE** for constants (`JWT_SECRET`, `MONGODB_URI`)
- Always destructure function arguments in usecases: `async ({ garageId, search, page }) => {}`

---

## Route Definition Rules

```typescript
// Correct pattern
import express from 'express';
const router = express.Router();
import { getItems, getItem, createItem, updateItem, deleteItem } from '../controllers/itemController';
import { protect, authorize } from '../middleware/auth';
import asyncHandler from '../middleware/asyncHandler';

// Apply auth middleware to all routes in this router
router.use(protect);

router.route('/')
  .get(asyncHandler(getItems))
  .post(authorize('owner', 'admin'), asyncHandler(createItem));

router.route('/:id')
  .get(asyncHandler(getItem))
  .put(authorize('owner', 'admin'), asyncHandler(updateItem))
  .delete(authorize('owner', 'admin'), asyncHandler(deleteItem));

export default router;
```

Note: `req.params.<name>` types as `string | string[]` under Express 5's types (it supports repeating route params). Since none of our routes use that feature, cast explicitly at the top of the handler: `const id = req.params.id as string;` — don't destructure `const { id } = req.params` directly, it won't satisfy a `string`-typed usecase argument.

### Rules:
- Always wrap async handlers with `asyncHandler()` — Express 5 needs this for proper error propagation
- Apply `protect` at the router level with `router.use(protect)` (unless the route is public)
- Apply `authorize(...)` per route for role-based access
- Use `router.route()` chaining for clean verb grouping
- Available roles: `owner`, `admin`, `service_advisor`, `mechanic`, `receptionist`

---

## API Response Format

**All API responses MUST follow this envelope:**

```javascript
// Success
res.status(200).json({
  success: true,
  data: { ... }           // Single item
});

// Success with list
res.status(200).json({
  success: true,
  count: items.length,
  total: 150,
  pages: 15,
  currentPage: 1,
  data: [...]
});

// Success — delete
res.status(200).json({
  success: true,
  message: 'Resource deleted successfully'
});

// Error
res.status(4xx).json({
  success: false,
  message: 'Human-readable error description'
});
```

### Rules:
- Always include `success: true/false` in every response
- Use `data` for the payload (singular object or array)
- For paginated lists, always include `count`, `total`, `pages`, `currentPage`
- Use `201` for resource creation, `200` for everything else successful
- Never expose stack traces in production responses

---

## Error Handling

### In Usecases — Throw an `HttpError`

```typescript
import { HttpError } from '../utils/httpError';

// Correct
throw new HttpError('Customer not found', 404);

// Wrong — don't return res from usecase
return res.status(404).json({ ... });
```

`HttpError` (in `utils/httpError.ts`) is a small `Error` subclass carrying `.statusCode`, typed so `middleware/errorHandler.ts` can read it without casting. It replaces the old ad-hoc `const error = new Error(...); error.statusCode = X;` pattern.

### In Controllers — Always use try/catch + next(error)

```typescript
export const getItem = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = req.params.id as string;
    const item = await itemUsecase.getById(id);
    res.status(200).json({ success: true, data: item });
  } catch (error) {
    log.error('Failed to fetch item', { id: req.params.id, error: (error as Error).message });
    next(error);  // Let errorHandler middleware handle it
  }
};
```

`req.user` is set by `protect` but TypeScript can't see across middleware boundaries — use `req.user!` in the success path (protect guarantees it by the time a route handler runs) and `req.user?.` in `catch` blocks, matching the pattern used throughout `controllers/`.

### Error Handler Middleware handles:
- `CastError` → 404 "Resource not found"
- `11000` (duplicate key) → 400 "Duplicate value entered for '{field}'"
- `ValidationError` → 400 with joined validation messages
- Everything else → `err.statusCode || 500`

---

## Logging Standards

We use **Winston** with a structured child logger pattern.

### Setup in Every File

```typescript
import logger from '../utils/logger';
const log = logger.child('CustomerController');  // Service name matches the file
```

### When to Log

| Level     | Use for                                            | Example                                    |
| --------- | -------------------------------------------------- | ------------------------------------------ |
| `log.info`  | Successful operations, state transitions           | `'Customer created'`                       |
| `log.warn`  | Expected failures (404, auth denied, deactivated)  | `'Customer not found'`                     |
| `log.error` | Unexpected failures, caught exceptions             | `'Failed to create customer'`              |
| `log.debug` | Verbose debugging (disabled in prod)               | `'Query params received'`                  |

### Always Include Context

```javascript
// Good — structured metadata
log.info('Customer created', { customerId: customer._id, garageId });

// Bad — template string, no structured data
log.info(`Customer ${customer._id} created for garage ${garageId}`);
```

### Logging Pattern in Controllers

```javascript
// Log at the START of an operation
log.info('Creating new customer', { garageId, phone: req.body.phone });

// Log at the END of a successful operation
log.info('Customer created', { customerId: customer._id, garageId });

// Log in the CATCH block
log.error('Failed to create customer', { garageId: req.user?.garage?._id, error: error.message });
```

---

## Multi-Tenant (Garage Isolation) Rules

**Every data query MUST be scoped to a garage.**

```javascript
// Always filter by garage
const customer = await Customer.findOne({ _id: customerId, garage: garageId });

// Never query without garage scope (data leak!)
const customer = await Customer.findById(customerId);
```

### Rules:
- `garageId` comes from `req.user.garage._id` (set by the `protect` middleware)
- All models that hold tenant data must have a `garage` field (ObjectId, required)
- Always add a compound index: `schema.index({ garage: 1, <field>: 1 })`
- The ONLY exception is the `admin` routes which operate cross-garage

---

## Security Checklist

- [ ] All routes use `protect` middleware unless intentionally public
- [ ] Role-based access uses `authorize(...)` with the minimum required roles
- [ ] User input is never trusted — Mongoose validators + `express-validator` where needed
- [ ] `mongoSanitize` middleware prevents NoSQL injection
- [ ] `helmet()` sets security headers
- [ ] `hpp()` prevents HTTP parameter pollution
- [ ] Rate limiting is applied on all `/api` routes
- [ ] JWT secret is in environment variables, never hardcoded
- [ ] Error responses never expose stack traces in production
- [ ] Uploaded files are sanitized and stored in `/uploads` with appropriate access

---

## Model / Schema Rules

```typescript
import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IExample extends Document {
  _id: Types.ObjectId;
  name: string;
  garage: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const exampleSchema = new Schema<IExample>({
  name: {
    type: String,
    required: [true, 'Name is required'],  // Always include error messages
    trim: true
  },
  garage: {
    type: Schema.Types.ObjectId,
    ref: 'Garage',
    required: true                          // Always required for tenant data
  }
}, {
  timestamps: true                          // Always enable timestamps
});

// Always add relevant indexes
exampleSchema.index({ garage: 1, name: 1 });

export default mongoose.model<IExample>('Example', exampleSchema);
```

### Rules:
- Always use `{ timestamps: true }` on schemas
- Always add the `garage` field for tenant-scoped models
- Always include `required: [true, 'Descriptive message']` for mandatory fields
- Use `trim: true` on string fields
- Use `default: ''` for optional string fields (not `null`)
- Use `default: 0` for optional number fields
- Define compound indexes for frequently queried field combinations
- Model file name = PascalCase singular (`Customer.ts`, not `customers.ts`)
- Export a `Document`-extending interface (`IExample`) from the same file as the schema — don't put it in a separate types file
- If a domain field name collides with a Mongoose `Document` method (e.g. a vehicle's `model` field vs. `Document.model()`), extend `Omit<Document, 'thatField'>` instead of `Document` directly (see `models/Vehicle.ts`)
- Enum-like string fields (`enum: [...]`) should pull their allowed values from `types/domain.ts` (see below), not repeat the list inline

---

## Service Layer Rules

Services in `services/` handle external integrations (email, SMS, PDF generation, cron jobs).

### Rules:
- Services are **initialized at startup** via `init*()` functions called from `server.ts`
- Services export standalone functions, not classes
- Services use the child logger pattern: `const log = logger.child('EmailService');`
- Services should be resilient — wrap external calls in try/catch and log failures
- Never import services directly in controllers; call them from usecases or `server.ts`
- In tests, `services/emailService.ts` and `services/smsService.ts` are mocked globally in `tests/setup.ts` — never make a service call reach real SMTP/Twilio in a test

---

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

This applies to `scripts/`, `.github/workflows/`, `CONTRIBUTING.md`, and commit
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
- **Shared domain enums live in `types/domain.ts`.** `Role`, `JobStatus`, `ServiceType`, `PaymentStatus`, etc. are each a `const array + derived union type` (see the file for the pattern) — reuse them instead of re-typing string literals in a new usecase/model. These must stay in sync with the enum lists in the root `.agents/AGENTS.md`.
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
- [ ] Logging includes structured metadata (not string interpolation)
- [ ] `.env.production.example` is updated if new env vars are added
- [ ] No hardcoded secrets, URLs, or credentials
- [ ] `npm run typecheck` passes with zero errors
- [ ] New or changed usecases have at least one happy-path and one error-path test; new tenant-scoped entities have a tenant-isolation test
- [ ] `npm test` passes locally
