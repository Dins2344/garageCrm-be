<!-- Detailed reference for this repository, split by topic and read on demand.
     The always-on rules live in CLAUDE.md at the repo root. -->

# GaragePulse Backend — Code Standards Reference

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

