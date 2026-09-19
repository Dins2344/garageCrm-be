<!-- Detailed reference for this repository, split by topic and read on demand.
     The always-on rules live in CLAUDE.md at the repo root. -->

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

// Failures are logged once, by errorHandler — controllers have no catch block
```

---

## Multi-Tenant (Garage Isolation) Rules

**Every data query MUST be scoped to a garage.**

```typescript
// Always filter by garage
const customer = await db.query.customers.findFirst({
  where: and(eq(customers._id, customerId), eq(customers.garageId, garageId))
});

// Never query without garage scope (data leak!)
const customer = await db.query.customers.findFirst({ where: eq(customers._id, customerId) });
```

### Rules:
- `garageId` comes from `req.garageId` (set by the `protect` middleware)
- All tables that hold tenant data must have a `garageId` column, NOT NULL,
  `references(() => garages._id, { onDelete: 'cascade' })`
- Always add a compound index: `index('<table>_garage_<field>_idx').on(t.garageId, t.<field>)`
- A foreign key proves a referenced row exists, not whose it is — check that a
  `customerId` / `vehicleId` from the request belongs to the caller's garage
  before inserting a row that points at it
- The ONLY exception is the `admin` routes which operate cross-garage

---

## Security Checklist

- [ ] All routes use `protect` middleware unless intentionally public
- [ ] Role-based access uses `authorize(...)` with the minimum required roles
- [ ] User input is never trusted — every create/update runs its zod schema through `runSchema()`
- [ ] Every query is parameterised through Drizzle; a raw `sql` fragment never interpolates user input
- [ ] `helmet()` sets security headers
- [ ] Rate limiting is applied on all `/api` routes
- [ ] JWT secret is in environment variables, never hardcoded
- [ ] Error responses never expose stack traces in production

---

## Model / Schema Rules

```typescript
// config/schema.ts — the table
export const examples = pgTable('examples', {
  _id: idColumn(),                                   // 24-hex ObjectId, text
  name: text().notNull(),
  garageId: text().notNull().references(() => garages._id, { onDelete: 'cascade' }),
  ...timestamps                                      // createdAt / updatedAt, touched on update
}, (t) => [
  index('examples_garage_name_idx').on(t.garageId, t.name)
]);

// models/Example.ts — validation and serialisation
export { examples };
export type ExampleRow = typeof examples.$inferSelect;

export const createExampleSchema = z.object({
  name: requiredString('Name is required')            // Always include error messages
});
export const updateExampleSchema = z.object({
  name: requiredString('Name is required').optional()  // written out, never `.partial()`
});

export const exampleToApi = (row: object): ApiObject => serializeRow(row);
```

### Rules:
- Columns, indexes and foreign keys live in `config/schema.ts`; everything else about the entity in `models/<X>.ts`
- Always spread `...timestamps` and always add `garageId` for tenant-scoped tables
- Primary keys are `idColumn()` — never an integer or UUID on anything a client sees; both clients read `_id`
- `text().notNull().default('')` for optional strings (not null); `doublePrecision().notNull().default(0)` for numbers
- Enum-like string columns are plain `text`; the allowed values come from `types/domain.ts` and are enforced by the zod schema, so adding a value never needs a migration
- Nested objects and arrays that are never queried by content are `jsonb().$type<Shape>()` with the shape declared in `config/schema.ts`
- Reference columns are `<name>Id`; the relation is `<name>`; `serializeRow` collapses the pair to the single `<name>` key the API has always had
- Update schemas are written out without `.default()` — see the JSONB-merge note in `CLAUDE.md`
- Model file name = PascalCase singular (`Customer.ts`), table export = camelCase plural (`customers`)
- After any change to `config/schema.ts`: `npx drizzle-kit generate --name <what-changed>` and commit the SQL

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

