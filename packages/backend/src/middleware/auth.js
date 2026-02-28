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
        // Use clerk ID as placeholder email if none available (email column is unique + not null)
        const email = auth.sessionClaims?.email || `${auth.userId}@clerk.placeholder`;
        return db('users')
          .insert({
            clerk_id: auth.userId,
            email,
            name: auth.sessionClaims?.name || null,
          })
          .onConflict('clerk_id')
          .merge({ updated_at: db.fn.now() })
          .returning('*')
          .then(([newUser]) => newUser || db('users').where({ clerk_id: auth.userId }).first());
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
