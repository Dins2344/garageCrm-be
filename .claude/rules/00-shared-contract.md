<!-- SHARED RULE — the same file exists in all three GaragePulse repositories:
       Dins2344/garageCrm-be   (backend)
       Dins2344/garageCrm-fe   (web)
       Dins2344/garageCrm-app  (mobile)
     They are separate repos with no shared package, so a change here must be
     copied to the other two by hand. If you have all three cloned side by side,
     /mirror-check diffs them for you. -->
# GaragePulse — Shared Rules Across the Three Applications

> These rules apply to all three GaragePulse applications. Each one is a
> **separate repository, deployed independently**, so this file is duplicated
> into each repo rather than linked from a shared parent. Change it in one
> repo and copy the change to the other two.

---

## The Three Applications

| Repository | Stack | Deploys as |
| --- | --- | --- |
| `garageCrm-be` (backend) | Node 20 · Express 5 · Mongoose 9 · TypeScript | Docker image on EC2 |
| `garageCrm-fe` (frontend) | React 19 · Vite · Tailwind CSS 4 · TypeScript | Docker image (Nginx) |
| `garageCrm-app` (mobile) | React Native 0.81 · Expo 54 · TypeScript | Play Store / EAS build |

They share a backend API contract, a colour system and a set of enum values —
nothing else. There is no shared package, no workspace tooling and no common
build, so anything "shared" is duplicated by hand. That is why the sync rules
below matter.

Each repo carries its own `CLAUDE.md` (always-on rules) and `.claude/rules/`
(detailed reference).

---

## Cross-App Rules

### Shared API Contract

All three apps communicate through the same backend API. The response envelope is:

```json
{ "success": true, "data": { ... } }
{ "success": true, "count": 5, "total": 50, "pages": 5, "currentPage": 1, "data": [...] }
{ "success": false, "message": "Error description" }
```

- Frontend and mobile always access response data via `res.data.data`
- Both frontends store auth tokens under the key `garagepulse_token`
- Both frontends store user data under the key `garagepulse_user`

### Shared Color System

All three apps use the same visual palette. When modifying colors in one app, update the others:

| Color         | Hex       | Tailwind Token (web) |
| ------------- | --------- | -------------------- |
| Primary       | `#3b5ff8` | `primary-500`        |
| Background    | `#f9fafb` | `gray-50`            |
| Text Primary  | `#111827` | `gray-900`           |
| Text Secondary| `#4b5563` | `gray-600`           |
| Text Muted    | `#6b7280` | `gray-500`           |
| Border        | `#e5e7eb` | `gray-200`           |
| Success       | `#10b981` | `success`            |
| Warning       | `#f59e0b` | `warning`            |
| Danger        | `#ef4444` | `danger`             |
| Info          | `#3b82f6` | `info`               |

### Shared Enum Values

Backend, frontend, and mobile must use identical enum string values:

- **Roles:** `owner`, `admin`, `service_advisor`, `mechanic`, `receptionist`
- **Job Statuses:** `new`, `estimation_sent`, `approved`, `in_progress`, `quality_check`, `ready_for_pickup`, `delivered`, `cancelled`
- **Service Types:** `service`, `repair`, `accident`

When adding a new enum value, update all three codebases.

---

## Quick Reference — What Goes Where

| Change Type                     | Backend              | Frontend               | Mobile                 |
| ------------------------------- | -------------------- | ---------------------- | ---------------------- |
| New data entity                 | model → usecase → controller → route | apiService → page | apiService → screen |
| New API endpoint                | route + controller + usecase | apiService function | apiService function |
| New UI page/screen              | —                    | pages/ + App.jsx route | screens/ + AppNavigator |
| New reusable UI element         | —                    | components/            | components/            |
| New enum/constant               | model + controller   | utils/constants.js     | Inline (extract later) |
| New environment variable        | .env + .env.production.example | .env (VITE_ prefix) | .env (EXPO_PUBLIC_ prefix) |

---

## Universal Don'ts

1. **Never commit secrets** — API keys, JWT secrets, passwords
2. **Never use `console.log`** — use Winston logger (backend) or remove before commit (frontend/mobile)
3. **Never hardcode colors** — use theme tokens (web) or documented hex values (mobile)
4. **Never skip error handling** — try/catch with user-friendly feedback
5. **Never skip loading states** — always show a loader/spinner while fetching
6. **Never bypass auth** — all data queries must be garage-scoped (backend)
7. **Never hardcode API URLs** — use environment variables
8. **Never pass full objects in navigation params** — pass IDs, fetch on detail screens
9. **Never use emoji anywhere** — in UI text, log lines, commit messages, docs, or scripts. Use the app's icon set instead (see below)
10. **Never build a new component before checking for an existing one** — and never style a new one from generic defaults

---

