import { rateLimit, MemoryStore, ipKeyGenerator } from 'express-rate-limit';

// Exported so the test harness can reset counts between tests.
export const authStore = new MemoryStore();
export const authSessionStore = new MemoryStore();
export const userStore = new MemoryStore();
export const inviteStore = new MemoryStore();

const WINDOW_MS = 10 * 60 * 1000;

/**
 * nginx appends the real client address as the rightmost X-Forwarded-For entry;
 * everything to its left is client-controlled. We cannot set Express "trust proxy"
 * (it would change GaragePulse), so read the rightmost entry here.
 */
const clientIp = (xff: string | undefined, ip: string | undefined): string => {
  const last = xff?.split(',').pop()?.trim();
  return ipKeyGenerator(last || ip || 'unknown');
};

export const authLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: 30,
  store: authStore,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, message: 'Too many attempts. Try again in a few minutes.' },
  keyGenerator: (req) => clientIp(req.headers['x-forwarded-for'] as string | undefined, req.ip),
  // We read X-Forwarded-For ourselves, which is what this check warns about.
  // The key already goes through ipKeyGenerator inside clientIp.
  validate: { xForwardedForHeader: false, keyGeneratorIpFallback: false }
});

// Refresh and sign-out are cheap and happen on every app start, so they get a looser cap.
export const authSessionLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: 300,
  store: authSessionStore,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, message: 'Too many attempts. Try again in a few minutes.' },
  keyGenerator: (req) => clientIp(req.headers['x-forwarded-for'] as string | undefined, req.ip),
  // The key already goes through ipKeyGenerator inside clientIp.
  validate: { xForwardedForHeader: false, keyGeneratorIpFallback: false }
});

export const userLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: 600,
  store: userStore,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests. Try again in a few minutes.' },
  keyGenerator: (_req, res) => res.locals.mgUserId as string
});

// Creating or resending an invite sends an email, so it is capped per user.
export const inviteLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  store: inviteStore,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, message: 'Too many invites sent. Try again later.' },
  keyGenerator: (_req, res) => res.locals.mgUserId as string
});
