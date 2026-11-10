import { Request, Response } from 'express';
import * as invites from '../usecases/inviteUsecase';
import { garageIdSchema } from '../models/Garage';
import { createSchema, INVITE_BAD_INPUT, INVITE_GONE, inviteIdSchema, TOKEN_PATTERN, tokenSchema } from '../models/Invite';
import { HttpError } from '../../utils/httpError';

const bad = (): never => {
  throw new HttpError(INVITE_BAD_INPUT, 400);
};
const me = (res: Response): string => res.locals.mgUserId;
const inviteId = (req: Request): string => {
  const p = inviteIdSchema.safeParse(req.params.inviteId);
  return p.success ? p.data : bad();
};

export const create = async (req: Request, res: Response): Promise<void> => {
  const garageId = garageIdSchema.safeParse(req.params.garageId);
  const body = createSchema.safeParse(req.body);
  if (!garageId.success || !body.success) return bad();
  res.status(201).json({ success: true, data: await invites.createInvite({ userId: me(res), garageId: garageId.data, ...body.data }) });
};
export const resend = async (req: Request, res: Response): Promise<void> => {
  res.json({ success: true, data: await invites.resendInvite({ userId: me(res), inviteId: inviteId(req) }) });
};
export const cancel = async (req: Request, res: Response): Promise<void> => {
  await invites.cancelInvite({ userId: me(res), inviteId: inviteId(req) });
  res.json({ success: true });
};
export const mine = async (_req: Request, res: Response): Promise<void> => {
  res.json({ success: true, data: { invites: await invites.listMyInvites({ userId: me(res) }) } });
};
export const accept = async (req: Request, res: Response): Promise<void> => {
  res.json({ success: true, data: await invites.acceptInvite({ userId: me(res), inviteId: inviteId(req) }) });
};
export const decline = async (req: Request, res: Response): Promise<void> => {
  await invites.declineInvite({ userId: me(res), inviteId: inviteId(req) });
  res.json({ success: true });
};
export const acceptLink = async (req: Request, res: Response): Promise<void> => {
  const body = tokenSchema.safeParse(req.body);
  if (!body.success) throw new HttpError(INVITE_GONE, 404);
  res.json({ success: true, data: await invites.acceptByToken({ userId: me(res), token: body.data.token }) });
};

const PLAY = 'https://play.google.com/store/apps/details?id=com.dctechs.mygarage';
const page = (body: string): string =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>MyGarage invite</title>` +
  `<style>body{font-family:system-ui,sans-serif;margin:0;padding:48px 24px;text-align:center;color:#2D3434}a{display:inline-block;margin-top:24px;padding:14px 24px;border-radius:10px;background:#027F86;color:#fff;text-decoration:none;font-weight:600}</style>` +
  `</head><body>${body}</body></html>`;

/** Public and does no lookup: the token is only forwarded to the app, which asks the server as the signed-in user. */
export const linkPage = (req: Request, res: Response): void => {
  res.set('Referrer-Policy', 'no-referrer');
  const token = String(req.params.token);
  if (!TOKEN_PATTERN.test(token)) {
    res.status(404).type('html').send(page('<h1>Invite not found</h1><p>This invite link is not valid.</p>'));
    return;
  }
  const url = `intent://invite/${token}#Intent;scheme=mygarage;package=com.dctechs.mygarage;S.browser_fallback_url=${encodeURIComponent(PLAY)};end`;
  res.type('html').send(page(
    `<h1>You have a MyGarage invite</h1><p>Open it on your Android phone with the Google account it was sent to.</p>` +
    `<a href="${url}">Open in MyGarage</a><script>location.replace(${JSON.stringify(url)});</script>`
  ));
};
