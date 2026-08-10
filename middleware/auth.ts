import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import User from '../models/User';
import logger from '../utils/logger';
import { Role } from '../types/domain';
import { AuthenticatedUser } from '../types/express';

const log = logger.child('AuthMiddleware');

interface AccessTokenPayload {
  id: string;
  role: Role;
}

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
    const user = await User.findById(decoded.id).populate('garage');

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

    req.user = user as unknown as AuthenticatedUser;

    log.debug('User authenticated successfully', { userId: user._id, role: user.role });
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
    if (!req.user || !roles.includes(req.user.role)) {
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
