const nodemailer = require('nodemailer');
const config = require('../config/environment');
const logger = require('../config/logger');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  if (!config.smtpHost || !config.smtpUser) {
    return null;
  }
  transporter = nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort || 587,
    secure: config.smtpPort === 465,
    auth: {
      user: config.smtpUser,
      pass: config.smtpPass,
    },
  });
  return transporter;
}

async function sendMail(to, subject, html) {
  const t = getTransporter();
  if (!t) {
    logger.warn('SMTP not configured, skipping email', { to, subject });
    return null;
  }
  try {
    const result = await t.sendMail({
      from: config.smtpFrom || config.smtpUser,
      to,
      subject,
      html,
    });
    logger.info('Email sent', { to, subject, messageId: result.messageId });
    return result;
  } catch (err) {
    logger.error('Failed to send email', { to, subject, error: err.message });
    return null;
  }
}

async function sendWaitlistNotification(entry) {
  return sendMail(
    config.adminEmail,
    `New Waitlist Signup: ${entry.email}`,
    `<div style="font-family:sans-serif;max-width:500px">
      <h2 style="color:#4f46e5">New Waitlist Entry</h2>
      <p><strong>Email:</strong> ${entry.email}</p>
      ${entry.name ? `<p><strong>Name:</strong> ${entry.name}</p>` : ''}
      ${entry.company ? `<p><strong>Company:</strong> ${entry.company}</p>` : ''}
      ${entry.use_case ? `<p><strong>Use Case:</strong> ${entry.use_case}</p>` : ''}
      <p style="color:#6b7280;font-size:12px">Submitted at ${new Date().toISOString()}</p>
    </div>`
  );
}

async function sendWaitlistConfirmation(entry) {
  return sendMail(
    entry.email,
    "You're on the Imagia waitlist!",
    `<div style="font-family:sans-serif;max-width:500px">
      <h2 style="color:#4f46e5">Welcome to the Imagia Waitlist</h2>
      <p>Hi${entry.name ? ` ${entry.name}` : ''},</p>
      <p>Thanks for signing up! You're on our waitlist and we'll let you know as soon as we're ready for you.</p>
      <p>Imagia is an AI-powered app builder that lets you create, deploy, and manage web applications through a conversational interface.</p>
      <p style="color:#6b7280;font-size:13px">— The Imagia Team</p>
    </div>`
  );
}

module.exports = { sendMail, sendWaitlistNotification, sendWaitlistConfirmation };
