const jwt = require('jsonwebtoken');
const User = require('../models/User');
const logger = require('../utils/logger');

const log = logger.child('AuthMiddleware');

// Protect routes -- require authentication
const protect = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  } else if (req.cookies && req.cookies.token) {
    token = req.cookies.token;
  }

  if (!token) {
    log.warn('Access denied - no token provided', { method: req.method, url: req.originalUrl, ip: req.ip });
    return res.status(401).json({
      success: false,
      message: 'Not authorized to access this route'
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(decoded.id).populate('garage');

    if (!req.user) {
      log.warn('Token valid but user not found in database', { userId: decoded.id });
      return res.status(401).json({
        success: false,
        message: 'User not found'
      });
    }

    if (!req.user.isActive) {
      log.warn('Deactivated user attempted access', { userId: req.user._id, email: req.user.email });
      return res.status(403).json({
        success: false,
        message: 'Account has been deactivated'
      });
    }

    log.debug('User authenticated successfully', { userId: req.user._id, role: req.user.role });
    next();
  } catch (error) {
    log.warn('Token verification failed', { error: error.message, ip: req.ip });
    return res.status(401).json({
      success: false,
      message: 'Not authorized to access this route'
    });
  }
};

// Role-based authorization
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      log.warn('Authorization denied - insufficient role', {
        userId: req.user._id,
        userRole: req.user.role,
        requiredRoles: roles,
        method: req.method,
        url: req.originalUrl
      });
      return res.status(403).json({
        success: false,
        message: `Role '${req.user.role}' is not authorized to access this route`
      });
    }
    next();
  };
};

module.exports = { protect, authorize };
