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

async function send({ to, bcc, subject, text, html, replyTo }) {
  const t = transport();
  if (!t) throw new Error('Email is not configured');
  return t.sendMail({ from: CFG.from, to, bcc, subject, text, html, replyTo });
}

// Wrap a plain admin message in a simple branded HTML shell.
function adminHtml(subject, bodyText) {
  const esc = (s) => String(s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const body = esc(bodyText).replace(/\n/g, '<br>');
  return `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:560px;margin:auto;color:#1f2933;line-height:1.6">
    <div style="background:#2196f3;color:#fff;padding:16px 20px;border-radius:10px 10px 0 0;font-weight:700;font-size:18px">gweno</div>
    <div style="border:1px solid #e0e0e0;border-top:none;border-radius:0 0 10px 10px;padding:22px 20px">
      ${subject ? `<h2 style="margin:0 0 12px;font-size:18px;color:#1f2933">${esc(subject)}</h2>` : ''}
      <div style="font-size:15px">${body}</div>
      <p style="color:#6b7280;font-size:12px;margin-top:24px;border-top:1px solid #eee;padding-top:12px">Sent from the Gweno team · <a href="${DASHBOARD_URL}" style="color:#1976d2">gweno.vercel.app</a></p>
    </div>
  </div>`;
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

const DASHBOARD_URL = process.env.APP_URL || 'https://gweno.vercel.app';

// ---- Task-decision notifications (sent by the admin approve/reject/correction flow) ----
async function sendTaskApproved({ to, name, task, amount, balance }) {
  const text =
`Hello ${name},

We are pleased to inform you that your submission for ${task} has been reviewed and approved.

Your submission has been received successfully, and the task earnings have been credited to your account balance.

Amount Credited: ${amount}
Updated Balance: ${balance}

You can now log in to your dashboard to view your updated balance and continue working on additional tasks.

Dashboard:
${DASHBOARD_URL}

Withdrawal Reminder
When requesting a withdrawal, please ensure that you enter the correct payment details and account credentials. Incorrect or incomplete withdrawal information may result in delayed or unsuccessful transactions.

Before submitting a withdrawal request, please verify:
- Account holder name
- Phone number or payment account
- Selected payment method
- Any other required withdrawal details

We are unable to guarantee successful withdrawals if incorrect information is provided.

Thank you for being part of gweno.

gweno Team`;
  return send({ to, subject: 'Task Approved & Earnings Credited', text });
}

async function sendWithdrawalPaid({ to, name, gross, fee, net, reference, date }) {
  const text =
`Hello ${name},

Good news — your withdrawal has been approved and paid.

Gross amount: ${gross}
Withdrawal fee (20%): ${fee}
Net amount sent to you: ${net}

Reference: ${reference}
Date: ${date}

The net amount has been sent to the payout details on your request. If you have any questions about this payment, simply reply to this email.

Thank you for being part of gweno.

gweno Team`;
  return send({ to, subject: 'Withdrawal Approved & Paid', text });
}

async function sendWithdrawalSuccess({ to, name }) {
  const text =
`Hello ${name},

Payment Sent Successfully

Your withdrawal has been processed successfully. Please check your payment account. Thank you for using our platform.

gweno Team`;
  return send({ to, subject: 'Payment Sent Successfully', text });
}

async function sendShareYourSuccess({ to, name, tiktok }) {
  const text =
`Hello ${name},

Share Your Success

Your support helps our community grow. If you'd like, you're welcome to share your successful payment experience with others on WhatsApp or by posting it on TikTok.

You can also visit our official TikTok page using the link below, repost our content, or share your experience with your audience. Every share helps more people discover new earning opportunities through our platform.

Official TikTok: ${tiktok}

Thank you for being a valued member of our community. Your support is greatly appreciated.

gweno Team`;
  return send({ to, subject: 'Share Your Success', text });
}

async function sendApplicationApproved({ to, name, task }) {
  const text =
`Hello ${name},

Your application for ${task} has been approved.

You may now log in and begin working on the task.

Dashboard:
${DASHBOARD_URL}

Thank you,
gweno Team`;
  return send({ to, subject: 'Task Application Approved', text });
}

async function sendTaskRejected({ to, name, task }) {
  const text =
`Hello ${name},

Unfortunately, your application for ${task} was not approved at this time.

You are welcome to apply for other available tasks.

Thank you for your interest.

gweno Team`;
  return send({ to, subject: 'Task Application Update', text });
}

async function sendTaskCorrection({ to, name, task, reason }) {
  const text =
`Hello ${name},

Your submission for ${task} needs a correction before it can be approved.

Reason for Correction:
${reason || 'Please review your submission and provide the requested details.'}

Please review the reason above, make the necessary changes, and resubmit the task from your dashboard.

Dashboard:
${DASHBOARD_URL}

Thank you,
gweno Team`;
  return send({ to, subject: 'Task Correction Required', text });
}

async function sendSupport({ fromEmail, subject, message }) {
  return send({
    to: CFG.supportTo,
    replyTo: fromEmail,
    subject: `[Support] ${subject}`,
    text: `From: ${fromEmail}\n\n${message}`,
  });
}

// Free-form admin email (per-user via `to`, or broadcast via `bcc` list). Branded HTML.
async function sendAdmin({ to, bcc, subject, body }) {
  return send({ to: to || CFG.from, bcc, subject, text: body, html: adminHtml(subject, body) });
}

async function sendSubscriptionActivated({ to, name, plan, expires }) {
  const text =
`Hello ${name},

Your ${plan} subscription has been activated successfully. Your payment was confirmed and your plan is now unlocked — no further action is needed.

Plan: ${plan}
Status: Active
${expires ? `Renews / expires: ${expires}` : 'Access: does not expire'}

You can now access the tasks, questionnaires and features included in your plan.

Dashboard:
${DASHBOARD_URL}

Thank you for being part of gweno.

gweno Team`;
  return send({ to, subject: `Your ${plan} subscription is active`, text });
}

// Sent when an ADMIN manually changes a client's subscription plan (not a payment).
// Shows the previous and new plan; works dynamically for any valid plan.
async function sendPlanUpdated({ to, name, oldPlan, newPlan }) {
  const text =
`Dear ${name},

We are pleased to inform you that your subscription plan has been successfully updated.

Previous Plan: ${oldPlan}
New Plan: ${newPlan}

Your account has now been updated, and you can access the features, tasks, and benefits available under your new subscription plan.

Thank you for being part of GWENO.

Best regards,
GWENO Team`;
  return send({ to, subject: 'Your Subscription Plan Has Been Updated', text, html: adminHtml('Your Subscription Plan Has Been Updated', text) });
}

// Sent automatically when an admin promotes a Client to Regional Agent.
async function sendAgentPromotion({ to, name }) {
  const who = name || 'Client';
  const text =
`Dear ${who},

Congratulations!

We are pleased to inform you that, due to your hard work, commitment, and progress on the platform, your account has been upgraded from Client to Regional Agent in your respective region.

This is an important achievement, and we appreciate the effort and dedication that helped you reach this position. We encourage you to continue working hard, remaining active, and building trust within the platform.

Your journey does not end here. Just as your hard work and commitment helped you progress from being a Client to becoming a Regional Agent, continued dedication and strong performance may open further opportunities for advancement, including consideration for a higher-level or Replying Agent role.

We believe in your potential and encourage you to continue demonstrating responsibility, professionalism, trust, and commitment in your new role.

Congratulations once again on becoming a Regional Agent. We look forward to seeing your continued growth and success.

Best regards,
Gweno Team`;
  return send({ to, subject: 'Congratulations — You are now a Regional Agent 🎉', text, html: adminHtml('Congratulations — You are now a Regional Agent 🎉', text) });
}

module.exports = {
  configured, send, sendPasswordReset, sendMagicLink, sendSupport, CFG,
  sendTaskApproved, sendTaskRejected, sendTaskCorrection, sendApplicationApproved, sendWithdrawalPaid,
  sendWithdrawalSuccess, sendShareYourSuccess,
  sendAdmin, sendSubscriptionActivated, sendAgentPromotion, sendPlanUpdated,
};
