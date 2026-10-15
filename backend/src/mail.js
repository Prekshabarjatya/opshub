const nodemailer = require('nodemailer');
const config = require('./config');

let transport = null;
if (config.smtp.host) {
  transport = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.port === 465,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  });
}

// Fire-and-forget: a mail failure must never break messaging.
function sendTagEmails(recipients, { senderName, targetLabel, body }) {
  if (!transport || !recipients.length) return;
  const subject = `[OpsHub] ${senderName} tagged ${targetLabel}`;
  const text = `${senderName} sent a message to ${targetLabel}:\n\n${body}\n\nOpen OpsHub: ${config.appUrl}/messages`;
  for (const r of recipients) {
    if (!r.email) continue;
    transport
      .sendMail({ from: config.smtp.from, to: r.email, subject, text })
      .catch((err) => console.error('Email failed for', r.email, err.message));
  }
}

module.exports = { sendTagEmails };
