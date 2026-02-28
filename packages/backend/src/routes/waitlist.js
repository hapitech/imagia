const express = require('express');
const { db } = require('../config/database');
const { requireUser } = require('../middleware/auth');
const config = require('../config/environment');
const logger = require('../config/logger');
const { sendWaitlistNotification, sendWaitlistConfirmation } = require('../services/emailService');

const router = express.Router();

// Helper: check if current user is admin
function isAdmin(req) {
  return req.user && req.user.email === config.adminEmail;
}

// POST / — public, submit waitlist entry
router.post('/', async (req, res, next) => {
  try {
    const { email, name, company, use_case } = req.body;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Valid email is required' });
    }

    // Check if already on waitlist
    const existing = await db('waitlist_entries').where({ email: email.toLowerCase() }).first();
    if (existing) {
      return res.status(409).json({ error: 'This email is already on the waitlist' });
    }

    const [entry] = await db('waitlist_entries')
      .insert({
        email: email.toLowerCase(),
        name: name || null,
        company: company || null,
        use_case: use_case || null,
      })
      .returning('*');

    // Send emails (don't block on failure)
    sendWaitlistNotification(entry).catch((err) =>
      logger.error('Failed to send waitlist notification', { error: err.message })
    );
    sendWaitlistConfirmation(entry).catch((err) =>
      logger.error('Failed to send waitlist confirmation', { error: err.message })
    );

    res.status(201).json({ message: "You're on the waitlist!", entry: { email: entry.email, name: entry.name } });
  } catch (err) {
    next(err);
  }
});

// --- Admin routes below require auth ---
router.use(requireUser);

// GET / — admin only, list all entries
router.get('/', async (req, res, next) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { status } = req.query;
    let query = db('waitlist_entries').orderBy('created_at', 'desc');
    if (status) {
      query = query.where({ status });
    }

    const entries = await query;

    // Get counts by status
    const counts = await db('waitlist_entries')
      .select('status')
      .count('* as count')
      .groupBy('status');

    const stats = { total: 0, pending: 0, approved: 0, rejected: 0, invited: 0 };
    for (const row of counts) {
      stats[row.status] = parseInt(row.count, 10);
      stats.total += parseInt(row.count, 10);
    }

    res.json({ entries, stats });
  } catch (err) {
    next(err);
  }
});

// PATCH /:id — admin only, update status
router.patch('/:id', async (req, res, next) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { status } = req.body;
    const validStatuses = ['pending', 'approved', 'rejected', 'invited'];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({ error: `Status must be one of: ${validStatuses.join(', ')}` });
    }

    const update = { status, updated_at: db.fn.now() };
    if (status === 'invited') {
      update.invited_at = db.fn.now();
    }

    const [entry] = await db('waitlist_entries')
      .where({ id: req.params.id })
      .update(update)
      .returning('*');

    if (!entry) {
      return res.status(404).json({ error: 'Entry not found' });
    }

    res.json({ entry });
  } catch (err) {
    next(err);
  }
});

// DELETE /:id — admin only, remove entry
router.delete('/:id', async (req, res, next) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const deleted = await db('waitlist_entries').where({ id: req.params.id }).del();
    if (!deleted) {
      return res.status(404).json({ error: 'Entry not found' });
    }

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
