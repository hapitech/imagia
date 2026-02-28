const express = require('express');
const { Webhook } = require('svix');
const { db } = require('../config/database');
const config = require('../config/environment');
const logger = require('../config/logger');

const router = express.Router();

router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const webhookSecret = config.clerkWebhookSecret;

  if (!webhookSecret) {
    logger.error('CLERK_WEBHOOK_SECRET is not configured');
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  const svixId = req.headers['svix-id'];
  const svixTimestamp = req.headers['svix-timestamp'];
  const svixSignature = req.headers['svix-signature'];

  if (!svixId || !svixTimestamp || !svixSignature) {
    return res.status(400).json({ error: 'Missing svix headers' });
  }

  let event;
  try {
    const wh = new Webhook(webhookSecret);
    event = wh.verify(req.body, {
      'svix-id': svixId,
      'svix-timestamp': svixTimestamp,
      'svix-signature': svixSignature,
    });
  } catch (err) {
    logger.error('Webhook verification failed', { error: err.message });
    return res.status(400).json({ error: 'Invalid webhook signature' });
  }

  const { type, data } = event;

  try {
    switch (type) {
      case 'user.created': {
        const email =
          data.email_addresses && data.email_addresses.length > 0
            ? data.email_addresses[0].email_address
            : `${data.id}@clerk.placeholder`;

        await db('users')
          .insert({
            clerk_id: data.id,
            email,
            name: [data.first_name, data.last_name].filter(Boolean).join(' ') || null,
            avatar_url: data.image_url || null,
          })
          .onConflict('clerk_id')
          .merge({
            email,
            name: [data.first_name, data.last_name].filter(Boolean).join(' ') || null,
            avatar_url: data.image_url || null,
            updated_at: db.fn.now(),
          });

        logger.info('User created via webhook', { clerkId: data.id });
        break;
      }

      case 'user.updated': {
        const email =
          data.email_addresses && data.email_addresses.length > 0
            ? data.email_addresses[0].email_address
            : null;

        await db('users')
          .where({ clerk_id: data.id })
          .update({
            email: email,
            name: [data.first_name, data.last_name].filter(Boolean).join(' ') || null,
            avatar_url: data.image_url || null,
            updated_at: db.fn.now(),
          });

        logger.info('User updated via webhook', { clerkId: data.id });
        break;
      }

      case 'user.deleted': {
        await db('users').where({ clerk_id: data.id }).del();
        logger.info('User deleted via webhook', { clerkId: data.id });
        break;
      }

      default:
        logger.info('Unhandled webhook event type', { type });
    }

    res.status(200).json({ received: true });
  } catch (err) {
    logger.error('Webhook handler error', { error: err.message, type });
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

module.exports = router;
