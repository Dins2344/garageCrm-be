import { PublicUser } from '../models/User';
import { GarageRow } from '../models/Garage';

// After `protect` runs, req.user.garage is always the joined garage row
// (loaded with `db.query.users.findFirst({ with: { garage } })` in
// middleware/auth.ts). Secrets are never selected onto it.
export type AuthenticatedUser = PublicUser & {
  garage: GarageRow;
};

export interface AdminTokenPayload {
  isSuperAdmin: true;
  /** Admin row id — the token is resolved back to a record on every request. */
  sub: string;
  email: string;
  iat?: number;
  exp?: number;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      admin?: AdminTokenPayload;
      // The garage this request operates on, resolved by `protect` from the
      // `X-Garage-Id` header for owners (validated against garages.owner_id)
      // or the user's own `garage` for every other role. See middleware/auth.ts.
      garageId?: string;
    }
  }
}
