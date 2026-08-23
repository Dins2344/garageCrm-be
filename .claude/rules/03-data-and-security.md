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

