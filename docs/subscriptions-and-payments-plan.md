# Paid plans and payments for GaragePulse — strategy


**Status: design document, written 2026-09-17. Not implemented.** It exists so
that when implementation starts, the decisions, order and traps are already
written down. What *has* shipped from it: the six missing countries in
`backend/config/countries.ts`, the plan catalog at `GET /api/meta/plans`, the
web Pricing page and the mobile Plans screen — all read-only, with purchasing
disabled server-side.

Target countries: India, Sri Lanka, Bahrain, UAE, Nepal, Qatar, Kuwait,
Saudi Arabia. Decisions you gave: **no legal entity exists today**, and plans
are **prepaid periods with manual renewal** (no card-on-file to start).

---

## 0. The one thing that blocks everything: a seller

Every payment gateway, without exception, onboards a *merchant* — a person or
company with a bank account, a tax identity and a website carrying terms,
privacy and refund pages. Today there is none, so no gateway can be opened,
no invoice can name a seller, and no tax position exists.

**Recommendation, in order of effort:**

1. **Now — Indian sole proprietorship.** PAN + a current account in a trade
   name + Udyam registration. About a week and near-zero cost. Enough for
   Razorpay's "individual / unregistered business" tier, which accepts UPI,
   cards and net banking from Indian customers. This is the minimum that
   makes any of this possible.
2. **Before the first foreign customer — GST registration.** Not mandatory
   below ₹20 lakh turnover, but two things push you to register early:
   Indian garages that are GST-registered will want a GST invoice to claim
   input credit, and exports of services (every non-Indian customer) are
   **zero-rated only under a filed LUT**, which requires a GSTIN. Without it a
   foreign sale is simply untaxed income with no export paperwork, which is
   fine at tiny scale and a problem later.
3. **When Gulf revenue is real — a UAE free-zone company.** Only this unlocks
   the local schemes the Gulf actually pays with (Mada in Saudi, KNET in
   Kuwait, Benefit in Bahrain) through Tap/PayTabs/Stripe UAE, and AED
   settlement. Costs roughly AED 12–20k/year. Not for launch.

Also required before any gateway approves you: **a public website** with
Terms of Service, Privacy Policy, Refund/Cancellation Policy and contact
details, and a product description that matches what the gateway sees. The
marketing site does not exist today; the web app's login page is not enough.

Google Play is unaffected — the developer account you already have is fine
for an individual; a D-U-N-S number is only needed if you convert it to an
organisation account.

---

## 1. Country matrix

Two different taxes matter in every country and must not be confused:

- **The garage's own tax** on the invoices *our app prints for their
  customers* — already modelled as `settings.taxRate` / `taxLabel`. This is a
  product-readiness question: can a garage in that country use the app
  legally?
- **The tax on our subscription fee** — what we owe or must show when we
  bill the garage. Depends on who the seller is.

| | India | Sri Lanka | UAE | Saudi Arabia | Bahrain | Qatar | Kuwait | Nepal |
|---|---|---|---|---|---|---|---|---|
| In `countries.ts` today | yes | **no** | yes | **no** | **no** | **no** | **no** | **no** |
| Currency | INR | LKR | AED | SAR | BHD (**3 dp**) | QAR | KWD (**3 dp**) | NPR |
| Garage's own tax | GST 18% | VAT 18% | VAT 5% | VAT 15% | VAT 10% | none (planned) | none (planned) | VAT 13% |
| Tax on our fee (Indian seller) | GST 18% if registered | zero-rated export; LK charges VAT on foreign digital services from Oct 2025, registration threshold LKR 60M — irrelevant at launch | export; B2B reverse charge (get TRN); **B2C requires UAE VAT registration with no threshold** | export; B2B reverse charge (get VAT no.); B2C requires registration | export; B2B reverse charge | export; no VAT | export; no VAT | export; NP levies 2% DST + 13% VAT on foreign digital services above NPR 3M/yr — irrelevant at launch |
| How garages pay online | UPI, cards, net banking | Visa/MC; local gateway (PayHere) needs LK entity | cards, Apple/Google Pay | **Mada** debit dominant; international cards work but convert worse | **Benefit** debit dominant; cards | QPay/NAPS; cards | **KNET** dominant, **no recurring**; cards rare for locals | eSewa/Khalti wallets need NP entity; USD card spend abroad is capped by NRB (~$500/yr); India–Nepal cross-border UPI (2024) is worth investigating |
| Recurring feasible | yes (RBI e-mandate / UPI AutoPay, extra auth above ₹15k) | cards only | cards | cards; Mada tokenised | cards | cards | **no** on KNET | no |
| SMS sender-ID registration | DLT (TRAI) — Twilio international route works but is filtered; verification OTPs need a registered DLT template | light | **mandatory** (TDRA); unregistered OTPs often dropped | **mandatory** (CST); unregistered international senders are commonly blocked | mandatory (TRA) | mandatory (CRA) | mandatory (CITRA) | light |
| E-invoicing mandate on the garage's invoices | GST e-invoice only above ₹5 Cr turnover — not our users | none | **Peppol PINT-AE B2B, phased from July 2026** — invoice PDF alone will stop being compliant for VAT-registered garages | **ZATCA Fatoora** — every VAT-registered business; Phase 1 needs a TLV **QR code on the PDF**, Phase 2 needs API integration. **Our invoice PDF is not usable in Saudi today.** | VAT invoice fields only | none | none | none |
| Suggested price points (monthly, Plus / Pro) | ₹499 / ₹999 | LKR 2,900 / 5,900 | AED 49 / 99 | SAR 49 / 99 | BHD 5 / 10 | QAR 49 / 99 | KWD 4 / 8 | NPR 1,290 / 2,590 |

The price points are placeholders at roughly purchasing-power parity for you
to set; the mechanism (fixed local price per country, never live FX) is the
decision that matters.

**Things this table surfaces that are not "billing" but block selling there:**

- **Six of eight countries are missing from `config/countries.ts`.** Each needs
  currency, locale, tax label, tax-id label (GSTIN / VAT No. / TRN / PAN), postal
  label, phone example and default rates. A garage in Qatar today can only
  register as an Indian garage. This is the first ticket, independent of
  payments.
- **BHD and KWD have three decimal places.** `formatMoney` via `Intl` handles
  display, but every gateway's minor-unit conversion is ×1000, not ×100, and
  the estimation tax parity test rounds to 2dp — it must round to the
  currency's own precision.
- **Saudi Arabia cannot be sold to honestly until the invoice PDF carries the
  ZATCA QR** (a base64 TLV of seller name, VAT number, timestamp, total, VAT
  amount). It is a contained piece of work in `pdfService`, but it is
  mandatory, not optional, for any VAT-registered garage there.
- **The phone-verification gate depends on SMS delivery**, and four Gulf
  regulators block unregistered sender IDs. Either register a sender ID per
  country through Twilio (paperwork, weeks) or make **email verification
  sufficient for upgrade in those countries** and treat phone as optional.
  The gate you built is fine; the requirement needs to be per-country.
- **Kuwait and Nepal will convert poorly on cards alone.** Kuwait pays with
  KNET, Nepal cannot easily pay foreign merchants at all. Launch there
  knowing the paid conversion will be low until a Gulf entity (Kuwait) or a
  local partner (Nepal) exists — or treat those two as free-tier markets for
  now.
- **Arabic and right-to-left layout** are not required to sell — English UI
  is normal for SMB software in the Gulf — but the invoice PDF a Saudi or
  Emirati garage hands its customer will be expected to carry Arabic
  labels. Not a launch blocker; a first-quarter request.

---

## 2. The plans

Billing unit is the **owner account**, not the garage: an owner with two
branches pays once and the limits apply per garage. This matches how
`FREE_PLAN_LIMITS` already reads and how branches are modelled.

| | Free | Plus | Pro |
|---|---|---|---|
| Garages (branches) per owner | 2 | 3 | 10 |
| Job cards / garage / day | 3 | 10 | unlimited |
| Invoices / garage / day | 3 | 10 | unlimited |
| Staff / garage | 2 | 8 | unlimited |
| Service reminders | email only | email + SMS (quota, e.g. 200/mo) | email + SMS + WhatsApp (when built) |
| Invoice PDF | GaragePulse footer | garage logo, no footer | custom template, Arabic labels |
| Estimation approval link | yes | yes | yes |
| Dashboard | today + 7 days | 90 days + charts | full history + export |
| Data export (CSV) | no | customers, invoices | everything |
| Support | community | email, 2 business days | priority |
| Price | 0 | local price point | ~2× Plus |
| Annual | — | 10 × monthly (two months free) | 10 × monthly |

Rules that need deciding once, in code, not per screen:

- **Trial:** 14 days of Plus on registration, once per owner, no payment
  method required. The existing seeded-data problem is gone; a trial is
  what replaces "the app is empty on first open" as the reason to stay.
- **Grace period:** 7 days after expiry at full features with a banner, then
  downgrade to Free.
- **Downgrade never deletes.** Over-limit branches and staff become
  read-only (cannot create in them, can still view and invoice existing
  cards) until the owner picks which to keep or upgrades again. Deleting a
  paying customer's data because a card failed is the one thing that ends a
  SaaS.
- **Upgrade takes effect immediately; a mid-period plan change is prorated
  by days remaining** against the new plan's daily rate, paid as a one-off.
- **The verification gate you built** (email + phone verified) sits in front
  of checkout — with the per-country relaxation for phone noted above.

---

## 3. Payment architecture

### 3.1 Gateway strategy

**Phase 1 — one gateway: Razorpay.** Domestic Indian methods (UPI, cards,
net banking, wallets) plus **international cards** for the other seven
countries. Razorpay's international acceptance needs a KYC review after
onboarding and settles in INR; it can *present* prices in the customer's
currency (multi-currency), so a Dubai garage sees AED 49 and pays with a
Visa. Conversion will be weaker in Gulf countries than with local schemes,
but it is one integration, one webhook shape, one settlement account, and it
works from an Indian sole proprietorship.

**Phase 2 — Tap Payments for the Gulf** (KNET, Mada, Benefit, QPay, cards,
Apple Pay, one API for all five countries), which requires the UAE entity
from section 0. Sri Lanka (PayHere) and Nepal (eSewa/Khalti) each need a
local entity and are not worth it below a few hundred paying garages each.

**Why not Stripe first:** Stripe India onboards only registered companies by
invitation, and Stripe elsewhere needs an entity in that country.

### 3.2 Prepaid flow (what you chose)

1. Owner opens Billing on the **web app**, picks Plus or Pro, monthly or
   annual. Price and currency come from the owner's home-garage country.
2. Backend creates a `payments` row (pending) with a `SUB-YYMM-NNNN` number
   and a Razorpay **Order** for the amount in minor units, then returns the
   checkout parameters.
3. Razorpay's hosted checkout collects payment. No card data ever touches
   our servers — PCI stays Razorpay's problem.
4. Razorpay calls our **webhook** (`payment.captured`). We verify the
   signature, check the event id against `webhook_events` (idempotent —
   Razorpay retries), mark the payment paid, and **extend the subscription**:
   `currentPeriodEnd = max(now, currentPeriodEnd) + period`, so renewing
   early never loses days.
5. Receipt email with the tax breakdown; the payment row is the invoice.
6. Reminders at 7, 3 and 1 days before `currentPeriodEnd`, then the grace
   period, then downgrade — all from a daily cron, in the owner's timezone,
   the same way `cronScheduler` already does service reminders.

Auto-renewal (Razorpay Subscriptions with UPI AutoPay / card mandates) is a
later addition behind the same adapter, for India only.

### 3.3 Backend shape

New tables (`config/schema.ts`, one migration):

- `subscriptions` — `ownerId` (unique), `plan` (`free|plus|pro`), `status`
  (`trialing|active|grace|expired`), `currentPeriodEnd`, `trialEndsAt`,
  `country`, `currency`, `cancelledAt`.
- `payments` — `ownerId`, `subscriptionId`, `number`, `plan`, `period`,
  `amount`, `currency`, `taxRate`, `taxAmount`, `total`, `status`
  (`pending|paid|failed|refunded`), `provider`, `providerOrderId`,
  `providerPaymentId`, `paidAt`, `billingSnapshot` (JSONB: legal name, address,
  tax id at the time — invoices must not change when the profile does).
- `billing_profiles` — `ownerId`, legal name, address, tax id (GSTIN / TRN /
  VAT number / PAN), email for receipts. Collected at first checkout.
- `webhook_events` — `provider`, `eventId` (unique), `receivedAt`,
  `processedAt`, raw payload. Idempotency and an audit trail.

Code:

- `config/plans.ts` — the feature/limit matrix above and the per-country
  price table. `FREE_PLAN_LIMITS` becomes `limitsFor(plan)`.
- `usecases/billingUsecase.ts` — checkout, webhook handling, entitlement,
  proration, trial start, expiry sweep.
- `services/payments/` — a provider interface (`createOrder`,
  `verifyWebhook`, `parseEvent`, `refund`) with `razorpay.ts` first and
  `tap.ts` later. Secrets are env vars; the webhook secret is separate from
  the API key.
- `middleware/entitlement.ts` — `requirePlan('plus')` for gated routes and a
  `limitsFor(req.user)` used where `FREE_PLAN_LIMITS` is read today (job
  card, invoice, staff, branch creation). Resolved per request from the
  owner's subscription with a 60-second in-process cache; never baked into
  the JWT, which would let a downgrade linger for the token's life.
- Every auth payload and `GET /garage` carry `plan`, `status`,
  `currentPeriodEnd` so both clients can render state without a new call.
- Admin console: list subscriptions and payments, extend a period or grant
  a plan by hand (a support tool you will need on day one), see failed
  webhooks and replay them.
- Swagger for every new route; `checkSwagger` stays the gate.

### 3.4 Money handling rules

- Prices are **integers in minor units** in the price table; BHD/KWD use
  1000 minor units. Never store or compare floats for money.
- Tax on our fee is computed at checkout from the seller's position, not
  the buyer's country: Indian buyer + GST-registered seller → 18% shown as
  a separate line with your GSTIN; foreign buyer → 0 with "export of
  services" on the receipt and the buyer's tax number if given. Until GST
  registration, Indian buyers see no tax line and the receipt is not a GST
  invoice — say so on it.
- Refunds: full refund within 7 days of a first purchase, otherwise none —
  written on the refund policy page the gateway requires. Refund via the
  adapter, never by hand in the dashboard, so the payment row follows.
- Currency of a subscription is fixed at first purchase; a garage that
  changes country keeps billing in its original currency until the next
  period.

---

## 4. Google Play

Google's policy requires Play Billing for digital subscriptions sold **in
the app**, with a 15% fee, and forbids steering users to an outside payment
page from inside the app. The plan sidesteps it the way most business SaaS
does:

- **Checkout lives on the web only.** The mobile app shows the current plan,
  the renewal date and a neutral "Manage your plan on the web" line — no
  price, no button that opens a payment page. This is the "reader" pattern
  Google allows.
- India additionally permits alternative billing inside the app at a
  reduced fee (11–26%); not worth the complexity until mobile-only owners
  are a measurable share.
- Consequence to accept: an owner who only ever uses the phone has to open a
  laptop once to pay. Reminder emails carry the billing link.

---

## 5. Client work

- **Web:** a `Billing` page — current plan, usage against limits, the plan
  cards, the checkout hand-off, payment history with receipt download,
  billing profile form. `AuthContext` already refreshes the user; plan
  state rides on it.
- **Mobile:** a **Plan tile** on Settings (per the Settings-is-a-directory
  rule) opening a read-only `PlanScreen`: plan, renewal date, usage bars,
  the web note. Limit errors from the API (403 with the plan message, as the
  quota errors already are) render as an upgrade prompt that again points
  to the web.
- **Both:** the expiry/grace banner, and `plan` on the mirrored `User` /
  `Garage` types — identical edits, `/mirror-check` clean.

---

## 6. Order of work

| Phase | Weeks | Delivers |
|---|---|---|
| **0. Foundation** | 1–2 (mostly waiting) | Sole proprietorship, current account, website with the four policy pages, Razorpay account opened and international acceptance requested |
| **1. Country readiness** | 1 | Six countries in `countries.ts`; 3-decimal currencies through `formatMoney` and the tax parity test; ZATCA QR on the invoice PDF; per-country phone-verification requirement |
| **2. Plans without payments** | 1–2 | `subscriptions` table, `limitsFor(plan)`, entitlement middleware, trial on registration, expiry cron, grace and read-only downgrade, plan state on auth payloads, mobile Plan tile, admin grant tool. Everyone is on Free/trial; you can hand-grant Plus to early garages — this is worth shipping on its own |
| **3. Razorpay checkout** | 2 | Orders, hosted checkout, webhooks with idempotency, payments ledger, receipts, web Billing page, refund path, reminder emails |
| **4. Watch and adjust** | ongoing | Conversion per country; decide on the UAE entity and Tap when Gulf paying garages justify it; auto-renew for India if manual renewal churns |

Nothing in phases 1–2 depends on the entity or the gateway; they can start
tomorrow. Phase 3 cannot start until Razorpay has approved the account, so
open that account first.

---

## 7. Decisions still yours

1. The price points per country (section 1) and the exact limit numbers
   (section 2).
2. Whether Kuwait and Nepal launch as free-tier-only markets until local
   payment exists.
3. Whether phone verification is required for upgrade everywhere, or email
   suffices where sender-ID registration is impractical.
4. When to register for GST — recommended before the first paying customer
   outside India, for the LUT.
5. Whether the trial is 14 days of Plus or of Pro (Plus converts more
   honestly; Pro shows more).
