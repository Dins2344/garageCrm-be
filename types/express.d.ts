import { HydratedDocument, Types } from 'mongoose';
import { IUser } from '../models/User';
import { IGarage } from '../models/Garage';

// After `protect` runs, req.user.garage is always the populated Garage document
// (populated via `User.findById(...).populate('garage')` in middleware/auth.ts).
export type AuthenticatedUser = Omit<HydratedDocument<IUser>, 'garage'> & {
  garage: HydratedDocument<IGarage>;
};

export interface AdminTokenPayload {
  isSuperAdmin: true;
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
      // `X-Garage-Id` header for owners (validated against Garage.owner) or the
      // user's own `garage` for every other role. See middleware/auth.ts.
      garageId?: Types.ObjectId;
    }
  }
}
