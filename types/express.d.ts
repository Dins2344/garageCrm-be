import { HydratedDocument } from 'mongoose';
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
    }
  }
}
