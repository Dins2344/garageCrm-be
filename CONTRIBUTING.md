# GaragePulse Backend — Contributing & Code Standards

> **Last Updated:** August 2026
> **Stack:** Node.js · Express 5 · Mongoose 9 · Winston · JWT · CommonJS

---

## 📁 Project Structure

```
backend/
├── config/           # App configuration (db.js, swagger.js)
├── controllers/      # Thin HTTP controllers (parse req → call usecase → send res)
├── usecases/         # Core business logic (pure functions, no HTTP knowledge)
├── models/           # Mongoose schemas & models
├── routes/           # Express route definitions (verb + path + middleware)
├── middleware/        # Express middleware (auth, error handling, sanitization)
├── services/         # External integrations (email, SMS, PDF, cron)
├── utils/            # Shared utilities (logger)
├── scripts/          # One-off or migration scripts
├── logs/             # Auto-generated log files (gitignored)
├── nginx/            # Nginx reverse proxy config
├── server.js         # Application entry point
├── Dockerfile        # Production Docker image
└── docker-compose.yml
```

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

## 🧱 Architecture Rules

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
❌  controller → model       (skip usecase layer)
❌  usecase → req/res         (HTTP leak into business logic)
✅  controller → usecase → model
```

### Example — Adding a New Feature (e.g., "Suppliers")

```bash
# 1. Model
models/Supplier.js

# 2. Usecase (business logic)
usecases/supplierUsecase.js

# 3. Controller (HTTP thin wrapper)
controllers/supplierController.js

# 4. Route (wire it up)
routes/suppliers.js

# 5. Register in server.js
app.use('/api/suppliers', require('./routes/suppliers'));
```

---

## 📛 Naming Conventions

### Files

| Layer       | Pattern                  | Example                    |
| ----------- | ------------------------ | -------------------------- |
| Model       | `PascalCase.js`          | `Customer.js`, `JobCard.js` |
| Controller  | `camelCaseController.js` | `customerController.js`    |
| Usecase     | `camelCaseUsecase.js`    | `customerUsecase.js`       |
| Route       | `camelCase.js` (plural)  | `customers.js`, `jobCards.js` |
| Middleware  | `camelCase.js`           | `auth.js`, `errorHandler.js` |
| Service     | `camelCaseService.js`    | `emailService.js`          |

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

## 🔀 Route Definition Rules

```javascript
// ✅ Correct pattern
const express = require('express');
const router = express.Router();
const { getItems, createItem } = require('../controllers/itemController');
const { protect, authorize } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');

// Apply auth middleware to all routes in this router
router.use(protect);

router.route('/')
  .get(asyncHandler(getItems))
  .post(authorize('owner', 'admin'), asyncHandler(createItem));

router.route('/:id')
  .get(asyncHandler(getItem))
  .put(authorize('owner', 'admin'), asyncHandler(updateItem))
  .delete(authorize('owner', 'admin'), asyncHandler(deleteItem));

module.exports = router;
```

### Rules:
- Always wrap async handlers with `asyncHandler()` — Express 5 needs this for proper error propagation
- Apply `protect` at the router level with `router.use(protect)` (unless the route is public)
- Apply `authorize(...)` per route for role-based access
- Use `router.route()` chaining for clean verb grouping
- Available roles: `owner`, `admin`, `service_advisor`, `mechanic`, `receptionist`

---

## 📤 API Response Format

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

## 🚨 Error Handling

### In Usecases — Throw with `statusCode`

```javascript
// ✅ Correct
const err = new Error('Customer not found');
err.statusCode = 404;
throw err;

// ❌ Wrong — don't return res from usecase
return res.status(404).json({ ... });
```

### In Controllers — Always use try/catch + next(error)

```javascript
exports.getItem = async (req, res, next) => {
  try {
    const item = await itemUsecase.getById(req.params.id);
    res.status(200).json({ success: true, data: item });
  } catch (error) {
    log.error('Failed to fetch item', { id: req.params.id, error: error.message });
    next(error);  // Let errorHandler middleware handle it
  }
};
```

### Error Handler Middleware handles:
- `CastError` → 404 "Resource not found"
- `11000` (duplicate key) → 400 "Duplicate value entered for '{field}'"
- `ValidationError` → 400 with joined validation messages
- Everything else → `err.statusCode || 500`

---

## 📊 Logging Standards

We use **Winston** with a structured child logger pattern.

### Setup in Every File

```javascript
const logger = require('../utils/logger');
const log = logger.child('CustomerController');  // ← Service name matches the file
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
// ✅ Good — structured metadata
log.info('Customer created', { customerId: customer._id, garageId });

// ❌ Bad — template string, no structured data
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

## 🏢 Multi-Tenant (Garage Isolation) Rules

**Every data query MUST be scoped to a garage.**

```javascript
// ✅ Always filter by garage
const customer = await Customer.findOne({ _id: customerId, garage: garageId });

// ❌ Never query without garage scope (data leak!)
const customer = await Customer.findById(customerId);
```

### Rules:
- `garageId` comes from `req.user.garage._id` (set by the `protect` middleware)
- All models that hold tenant data must have a `garage` field (ObjectId, required)
- Always add a compound index: `schema.index({ garage: 1, <field>: 1 })`
- The ONLY exception is the `admin` routes which operate cross-garage

---

## 🔐 Security Checklist

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

## 🗄️ Model / Schema Rules

```javascript
const mongoose = require('mongoose');

const exampleSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Name is required'],  // Always include error messages
    trim: true
  },
  garage: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Garage',
    required: true                          // Always required for tenant data
  }
}, {
  timestamps: true                          // Always enable timestamps
});

// Always add relevant indexes
exampleSchema.index({ garage: 1, name: 1 });

module.exports = mongoose.model('Example', exampleSchema);
```

### Rules:
- Always use `{ timestamps: true }` on schemas
- Always add the `garage` field for tenant-scoped models
- Always include `required: [true, 'Descriptive message']` for mandatory fields
- Use `trim: true` on string fields
- Use `default: ''` for optional string fields (not `null`)
- Use `default: 0` for optional number fields
- Define compound indexes for frequently queried field combinations
- Model file name = PascalCase singular (`Customer.js`, not `customers.js`)

---

## 📦 Service Layer Rules

Services in `services/` handle external integrations (email, SMS, PDF generation, cron jobs).

### Rules:
- Services are **initialized at startup** via `init*()` functions called from `server.js`
- Services export standalone functions, not classes
- Services use the child logger pattern: `const log = logger.child('EmailService');`
- Services should be resilient — wrap external calls in try/catch and log failures
- Never import services directly in controllers; call them from usecases or `server.js`

---

## 🧹 Code Style

### Module System
- **CommonJS** (`require` / `module.exports`) — not ES Modules
- Use `exports.functionName` for exporting multiple functions from controllers/usecases
- Use `module.exports` for exporting a single entity (models, middleware, utilities)

### Formatting
- 2 spaces for indentation
- Single quotes for strings
- Semicolons at end of statements
- Trailing commas in multi-line objects/arrays
- Blank line between logical sections (imports, setup, functions)

### Imports — Ordering
```javascript
// 1. Node.js built-in modules
const path = require('path');

// 2. Third-party packages
const express = require('express');

// 3. Internal modules — config first, then models, usecases, middleware, utils
const connectDB = require('./config/db');
const Customer = require('../models/Customer');
const customerUsecase = require('../usecases/customerUsecase');
const { protect, authorize } = require('../middleware/auth');
const logger = require('../utils/logger');
```

---

## 🔧 Environment Variables

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

## ✅ Pre-Push Checklist

Before pushing code, verify:

- [ ] No `console.log` — use the `logger` utility instead
- [ ] All routes are wrapped in `asyncHandler()`
- [ ] All queries are scoped to `garageId` (unless admin)
- [ ] Error handling follows the throw-with-statusCode pattern
- [ ] New models include `timestamps: true` and `garage` field
- [ ] New routes are registered in `server.js`
- [ ] Logging includes structured metadata (not string interpolation)
- [ ] `.env.production.example` is updated if new env vars are added
- [ ] No hardcoded secrets, URLs, or credentials
