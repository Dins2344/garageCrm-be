import { z } from 'zod';

export const INVITES_UNAVAILABLE = 'Inviting is unavailable right now. Try again later.';
export const SEND_FAILED = 'Could not send the invite email. Try again.';
export const SELF_INVITE = "You can't invite yourself.";
export const ALREADY_MEMBER = 'This person already has access.';
export const ALREADY_INVITED = 'An invite to this email is already waiting. Resend it instead.';
export const GARAGE_FULL = 'This garage already has 10 people.';
export const TOO_MANY_PENDING = 'Too many invites waiting. Cancel some first.';
export const INVITE_GONE = 'This invite is no longer valid.';
export const TOO_MANY_TODAY = 'Too many invites today. Try again tomorrow.';
export const INVITE_BAD_INPUT = 'Invite request was not valid.';
export const wrongAccount = (email: string): string => {
  const [name, domain] = email.split('@');
  return `This invite is for ${name[0]}***@${domain}. Sign in with that Google account to accept.`;
};
export const expired = (inviterName: string): string => `This invite has expired. Ask ${inviterName} to send a new one.`;

export const INVITE_TTL_MS = 12 * 60 * 60 * 1000;
export const MAX_PEOPLE = 10;
export const MAX_PENDING = 10;
export const MAX_MAILS_PER_USER_PER_DAY = 20;
export const MAX_MAILS_PER_DAY = 100;
/** Ended invites keep the email only until they expire, plus this grace for the "expired" message. */
export const EXPIRED_KEEP_MS = 3 * 24 * 60 * 60 * 1000;

export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const normalizeEmail = (email: string): string => email.trim().toLowerCase();
/** Gmail ignores dots and "+tag" in the name and treats googlemail.com as gmail.com; every other address compares as typed. */
export const canonicalEmail = (email: string): string => {
  const e = normalizeEmail(email);
  const at = e.lastIndexOf('@');
  const domain = e.slice(at + 1);
  if (domain !== 'gmail.com' && domain !== 'googlemail.com') return e;
  return `${e.slice(0, at).split('+')[0].replace(/\./g, '')}@gmail.com`;
};

export const createSchema = z.object({
  email: z.string().trim().max(254).email().transform((e) => e.toLowerCase()),
  role: z.enum(['editor', 'viewer']),
  garageName: z.string().trim().min(1).max(60)
});
export const inviteIdSchema = z.string().min(1).max(64);
export const tokenSchema = z.object({ token: z.string().regex(TOKEN_PATTERN) });
