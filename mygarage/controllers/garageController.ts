import { Request, Response } from 'express';
import * as garages from '../usecases/garageUsecase';
import { GARAGE_BAD_INPUT, garageIdSchema, memberIdSchema, releaseSchema, roleSchema } from '../models/Garage';
import { HttpError } from '../../utils/httpError';

const bad = (): never => {
  throw new HttpError(GARAGE_BAD_INPUT, 400);
};
const garageId = (req: Request): string => {
  const p = garageIdSchema.safeParse(req.params.garageId);
  return p.success ? p.data : bad();
};
const memberId = (req: Request): string => {
  const p = memberIdSchema.safeParse(req.params.memberId);
  return p.success ? p.data : bad();
};
const me = (res: Response): string => res.locals.mgUserId;

export const list = async (_req: Request, res: Response): Promise<void> => {
  res.json({ success: true, data: { garages: await garages.listGarages({ userId: me(res) }) } });
};
export const share = async (req: Request, res: Response): Promise<void> => {
  res.json({ success: true, data: await garages.shareGarage({ userId: me(res), garageId: garageId(req) }) });
};
export const key = async (req: Request, res: Response): Promise<void> => {
  res.json({ success: true, data: { key: await garages.garageKey({ userId: me(res), garageId: garageId(req) }) } });
};
export const people = async (req: Request, res: Response): Promise<void> => {
  res.json({ success: true, data: await garages.listPeople({ userId: me(res), garageId: garageId(req) }) });
};
export const setRole = async (req: Request, res: Response): Promise<void> => {
  const body = roleSchema.safeParse(req.body);
  if (!body.success) return bad();
  await garages.setRole({ userId: me(res), garageId: garageId(req), memberId: memberId(req), role: body.data.role });
  res.json({ success: true });
};
export const removeMember = async (req: Request, res: Response): Promise<void> => {
  await garages.removeMember({ userId: me(res), garageId: garageId(req), memberId: memberId(req) });
  res.json({ success: true });
};
export const remove = async (req: Request, res: Response): Promise<void> => {
  await garages.deleteGarage({ userId: me(res), garageId: garageId(req) });
  res.json({ success: true });
};
export const release = async (req: Request, res: Response): Promise<void> => {
  const body = releaseSchema.safeParse(req.body);
  if (!body.success) return bad();
  res.json({ success: true, data: await garages.releasePersonal({ userId: me(res), garageId: garageId(req), ...body.data }) });
};
