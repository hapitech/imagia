const { clerkMiddleware, requireAuth, getAuth } = require('@clerk/express');
const { db } = require('../config/database');
const logger = require('../config/logger');

// Initialize Clerk middleware
const clerkAuth = clerkMiddleware();

// Require authentication and resolve user from DB
function requireUser(req, res, next) {
  const auth = getAuth(req);
  if (!auth || !auth.userId) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Authentication required' });
  }

  // Look up or lazily create user in our DB
  db('users')
    .where({ clerk_id: auth.userId })
    .first()
    .then((user) => {
      if (!user) {
        // User exists in Clerk but not in our DB yet (webhook may not have fired)
        return db('users')
          .insert({
            clerk_id: auth.userId,
            email: auth.sessionClaims?.email || 'unknown',
            name: auth.sessionClaims?.name || null,
          })
          .returning('*')
          .then(([newUser]) => newUser);
      }
      return user;
    })
    .then((user) => {
      req.user = user;
      next();
    })
    .catch((err) => {
      logger.error('Auth middleware error', { error: err.message });
      res.status(500).json({ error: 'Internal Server Error' });
    });
}

module.exports = { clerkAuth, requireAuth, requireUser };
