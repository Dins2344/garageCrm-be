import { z } from 'zod';

export const REFERRAL_CODE_RE = /^MG-[2-9A-HJKMNP-Z]{5}$/;
export const REWARD_DAYS = 30;
export const YEARLY_CAP = 12;
export const REDEEM_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export const redeemSchema = z.object({ code: z.string().max(20), source: z.enum(['play', 'typed']) });

export type RedeemResult = 'pending' | 'rewarded' | 'invalid' | 'own_code' | 'not_eligible';
