import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import { and, eq } from 'drizzle-orm';
import { db } from '../config/db';
import { users, USER_PUBLIC_COLUMNS, signUserToken } from '../models/User';
import { garages } from '../models/Garage';
import { isObjectIdHex } from '../utils/ids';
import logger from '../utils/logger';
import { Role } from '../types/domain';
import { AuthenticatedUser } from '../types/express';

const log = logger.child('AuthMiddleware');

interface AccessTokenPayload {
  id: string;
  role: Role;
  iat: number;
  /** Login time (epoch s). Missing on tokens issued before sliding sessions. */
  auth?: number;
}

export const TOKEN_COOKIE_OPTIONS = {
  // Outlives the JWT on purpose: an expired token still in the jar just 401s,
  // which is exactly the sign-out the clients want after a long absence.
  maxAge: 30 * 24 * 60 * 60 * 1000,
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
};

// Sliding session: a request carrying a token older than this gets a fresh
// one, so the JWT_EXPIRE window is "time since last request", not "time
// since login". The cap is the absolute end nothing slides past.
// ponytail: single 12h cap, make it per-role if a shift ever needs longer.
const RESIGN_AFTER_S = 60;
const SESSION_MAX_S = 12 * 60 * 60;

const slideToken = (res: Response, user: AuthenticatedUser, decoded: AccessTokenPayload): void => {
  const now = Math.floor(Date.now() / 1000);
  const auth = decoded.auth ?? decoded.iat;
  if (now - decoded.iat < RESIGN_AFTER_S || now - auth > SESSION_MAX_S) return;
  const fresh = signUserToken({ _id: user._id, role: user.role }, auth);
  res.cookie('token', fresh, TOKEN_COOKIE_OPTIONS); // web
  res.setHeader('X-Token', fresh); // mobile
};

// Resolves which garage a request operates on. Owners can act on any garage
// they own by passing `X-Garage-Id`; every other role is always confined to
// their own assigned garage, regardless of what header they send.
const resolveGarageId = async (
  user: AuthenticatedUser,
  garageIdHeader: string | string[] | undefined
): Promise<string | 'invalid' | 'forbidden'> => {
  if (user.role !== 'owner' || !garageIdHeader) {
    return user.garage._id;
  }

  const requestedId = Array.isArray(garageIdHeader) ? garageIdHeader[0] : garageIdHeader;
  if (!isObjectIdHex(requestedId)) {
    return 'invalid';
  }

  const owned = await db.query.garages.findFirst({
    columns: { _id: true },
    where: and(eq(garages._id, requestedId), eq(garages.ownerId, user._id))
  });
  if (!owned) {
    return 'forbidden';
  }
  return requestedId;
};

// Protect routes -- require authentication
export const protect = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  let token: string | undefined;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  } else if (req.cookies && req.cookies.token) {
    token = req.cookies.token;
  }

  if (!token) {
    log.warn('Access denied - no token provided', { method: req.method, url: req.originalUrl, ip: req.ip });
    res.status(401).json({
      success: false,
      message: 'Not authorized to access this route'
    });
    return;
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as AccessTokenPayload;
    const user = isObjectIdHex(decoded.id)
      ? await db.query.users.findFirst({
          columns: USER_PUBLIC_COLUMNS,
          where: eq(users._id, decoded.id),
          with: { garage: true }
        })
      : undefined;

    if (!user) {
      log.warn('Token valid but user not found in database', { userId: decoded.id });
      res.status(401).json({
        success: false,
        message: 'User not found'
      });
      return;
    }

    if (!user.isActive) {
      log.warn('Deactivated user attempted access', { userId: user._id, email: user.email });
      res.status(403).json({
        success: false,
        message: 'Account has been deactivated'
      });
      return;
    }

    req.user = user as AuthenticatedUser;

    const resolvedGarageId = await resolveGarageId(req.user, req.headers['x-garage-id']);
    if (resolvedGarageId === 'invalid') {
      res.status(400).json({ success: false, message: 'Invalid garage ID' });
      return;
    }
    if (resolvedGarageId === 'forbidden') {
      res.status(403).json({ success: false, message: 'You do not have access to this garage' });
      return;
    }
    req.garageId = resolvedGarageId;
    slideToken(res, req.user, decoded);

    log.debug('User authenticated successfully', { userId: user._id, role: user.role, garageId: req.garageId });
    next();
  } catch (error) {
    log.warn('Token verification failed', { error: (error as Error).message, ip: req.ip });
    res.status(401).json({
      success: false,
      message: 'Not authorized to access this route'
    });
  }
};

// Role-based authorization
export const authorize = (...roles: Role[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role as Role)) {
      log.warn('Authorization denied - insufficient role', {
        userId: req.user?._id,
        userRole: req.user?.role,
        requiredRoles: roles,
        method: req.method,
        url: req.originalUrl
      });
      res.status(403).json({
        success: false,
        message: `Role '${req.user?.role}' is not authorized to access this route`
      });
      return;
    }
    next();
  };
};
