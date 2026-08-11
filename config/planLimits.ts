// Free-tier usage caps. There is only one plan today; when paid subscriptions
// launch, this becomes a lookup keyed by the owner's plan instead of a flat export.
export const FREE_PLAN_LIMITS = {
  maxGaragesPerOwner: 2,
  maxJobCardsPerGaragePerDay: 3,
  maxInvoicesPerGaragePerDay: 3,
  maxStaffPerGarage: 2
} as const;
