// The Free-tier caps every quota check reads. They now come from the plan
// catalog in `config/plans.ts` — the single table both clients render — and
// this module exists only so the four usecases that import
// `FREE_PLAN_LIMITS` keep their import unchanged.
export { FREE_PLAN_LIMITS } from './plans';
