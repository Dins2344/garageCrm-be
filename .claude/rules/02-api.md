<!-- Detailed reference for this repository, split by topic and read on demand.
     The always-on rules live in CLAUDE.md at the repo root. -->

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

## API Documentation (Swagger)

Every endpoint must appear in the OpenAPI spec served at `/api-docs`. It is the
contract the web and mobile repos integrate against.

- **Annotations live in `config/swaggerDocs.ts`**, grouped under the section
  banners, not in the route files. `config/swagger.ts` globs both, but every
  existing block is in the central file — keep them together.
- **Shared shapes live in `config/swagger.ts`** under `components.schemas`,
  referenced with `$ref: '#/components/schemas/Name'`. Don't re-inline a body
  shape that already has a schema.
- **Public routes need `security: []`** — the spec defaults to `BearerAuth`.
  Platform-admin routes use `security: [{ AdminAuth: [] }]`.
- **Document the response codes the handler can actually return**, not just
  200. If it throws `HttpError(..., 404)`, the 404 belongs in the docs.
- **Changing a model or request shape means updating its schema too.** A stale
  schema is worse than a missing one — an integrator trusts it.

Verify with:

```bash
npx tsx scripts/checkSwagger.ts
```

It fails if a route registered in `app.ts` is missing from the spec, or if a
`$ref` points at a schema that doesn't exist.

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

