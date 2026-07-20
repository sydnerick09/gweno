/**
 * Real email via SMTP (nodemailer). Configure SMTP_* in .env. When not
 * configured, send() throws so callers can decide what to do.
 */
const nodemailer = require('nodemailer');

const CFG = {
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 587,
  user: process.env.SMTP_USER,
  pass: process.env.SMTP_PASS,
  from: process.env.MAIL_FROM || 'Gweno <no-reply@gweno.app>',
  supportTo: process.env.SUPPORT_EMAIL || process.env.SMTP_USER,
};

let transporter = null;
function configured() { return !!(CFG.host && CFG.user && CFG.pass); }
function transport() {
  if (!configured()) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: CFG.host,
      port: CFG.port,
      secure: CFG.port === 465, // 465 = implicit TLS, else STARTTLS
      auth: { user: CFG.user, pass: CFG.pass },
    });
  }
  return transporter;
}

async function send({ to, subject, text, html, replyTo }) {
  const t = transport();
  if (!t) throw new Error('Email is not configured');
  return t.sendMail({ from: CFG.from, to, subject, text, html, replyTo });
}

async function sendPasswordReset(to, link) {
  return send({
    to,
    subject: 'Reset your Gweno password',
    text: `We received a request to reset your Gweno password.\n\nReset it here (valid for 30 minutes):\n${link}\n\nIf you didn't request this, you can ignore this email.`,
    html: `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:auto;color:#241d3a">
      <h2 style="color:#7c3aed;margin:0 0 12px">Reset your password</h2>
      <p>We received a request to reset your Gweno password.</p>
      <p style="margin:20px 0"><a href="${link}" style="display:inline-block;background:#7c3aed;color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:600">Reset password</a></p>
      <p style="color:#6f6890;font-size:13px">This link is valid for 30 minutes. If you didn't request it, you can safely ignore this email.</p>
    </div>`,
  });
}

async function sendMagicLink(to, link) {
  return send({
    to,
    subject: 'Your Gweno sign-in link',
    text: `Here is your secure sign-in link for Gweno (valid for 15 minutes):\n${link}\n\nIf you didn't request this, you can safely ignore this email — no one can sign in without the link.`,
    html: `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:auto;color:#241d3a">
      <h2 style="color:#7c3aed;margin:0 0 12px">Sign in to Gweno</h2>
      <p>Tap the button below to sign in securely. No password needed.</p>
      <p style="margin:20px 0"><a href="${link}" style="display:inline-block;background:#7c3aed;color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:600">Sign in to Gweno</a></p>
      <p style="color:#6f6890;font-size:13px">This link is valid for 15 minutes and can be used once. If you didn't request it, you can safely ignore this email.</p>
    </div>`,
  });
}

async function sendSupport({ fromEmail, subject, message }) {
  return send({
    to: CFG.supportTo,
    replyTo: fromEmail,
    subject: `[Support] ${subject}`,
    text: `From: ${fromEmail}\n\n${message}`,
  });
}

module.exports = { configured, send, sendPasswordReset, sendMagicLink, sendSupport, CFG };
