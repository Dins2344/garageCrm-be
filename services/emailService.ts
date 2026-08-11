import nodemailer, { Transporter, SentMessageInfo } from 'nodemailer';
import logger from '../utils/logger';
const log = logger.child('EmailService');

// ───── Transport Setup ─────
// Uses SMTP config from env. Falls back to Ethereal (fake SMTP for dev/testing).
let transporter: Transporter | null = null;

const createEtherealTransport = async (): Promise<Transporter | null> => {
  try {
    const testAccount = await nodemailer.createTestAccount();
    const t = nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass
      }
    });
    log.info('Ethereal test email transport configured — emails will be captured for preview', {
      user: testAccount.user,
      web: 'https://ethereal.email/login'
    });
    return t;
  } catch (err) {
    log.warn('Failed to create Ethereal account, emails will be logged only', { error: (err as Error).message });
    return null;
  }
};

export const initTransport = async (): Promise<Transporter | null> => {
  if (transporter) return transporter;

  // Try configured SMTP first
  if (process.env.SMTP_HOST && process.env.SMTP_USER) {
    const port = parseInt(process.env.SMTP_PORT || '', 10) || 587;
    const secure = port === 465;

    const configuredTransport = nodemailer.createTransport({
      host: process.env.SMTP_HOST.trim(),
      port,
      secure,
      auth: {
        user: process.env.SMTP_USER.trim(),
        pass: (process.env.SMTP_PASS || '').trim()
      },
      tls: {
        ciphers: 'SSLv3',
        rejectUnauthorized: false
      }
    });

    try {
      await configuredTransport.verify();
      transporter = configuredTransport;
      log.info('SMTP transport verified and ready', { host: process.env.SMTP_HOST.trim(), port });
      return transporter;
    } catch (err) {
      log.warn(`Configured SMTP failed: ${(err as Error).message} — Falling back to Ethereal test emails`);
    }
  }

  // Fallback: Ethereal (catches all emails, viewable at ethereal.email)
  transporter = await createEtherealTransport();
  if (transporter) {
    try {
      await transporter.verify();
      log.info('Ethereal email transport verified and ready');
    } catch (err) {
      log.warn('Ethereal transport verification failed', { error: (err as Error).message });
    }
  }

  return transporter;
};

interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

interface SendEmailResult {
  logged: boolean;
  messageId: string | null;
  previewUrl?: string;
}

interface SkippedResult {
  skipped: true;
  reason: string;
}

// ───── Send Email ─────
export const sendEmail = async ({ to, subject, html, text }: SendEmailInput): Promise<SendEmailResult> => {
  try {
    const transport = await initTransport();
    if (!transport) {
      log.info('Email logged (no transport)', { to, subject });
      return { logged: true, messageId: null };
    }

    const from = process.env.SMTP_FROM || `"GaragePulse" <noreply@garagepulse.com>`;

    const info: SentMessageInfo = await transport.sendMail({ from, to, subject, html, text });

    // For Ethereal, log the preview URL
    const previewUrl = nodemailer.getTestMessageUrl(info);
    if (previewUrl) {
      log.info('Email sent (Ethereal preview)', { to, subject, preview: previewUrl });
    } else {
      log.info('Email sent', { to, subject, messageId: info.messageId });
    }

    return { logged: false, messageId: info.messageId, previewUrl: previewUrl || undefined };
  } catch (err) {
    log.error('Failed to send email', { to, subject, error: (err as Error).message });
    throw err;
  }
};

interface ServiceReminderEmailInput {
  customerName: string;
  customerEmail?: string;
  vehiclePlate: string;
  vehicleMake: string;
  vehicleModel: string;
  garageName: string;
  garagePhone: string;
  nextServiceDate: Date | string;
  reminderType: string;
}

// ───── Reminder Email Template ─────
export const sendServiceReminder = async ({
  customerName, customerEmail, vehiclePlate, vehicleMake, vehicleModel, garageName, garagePhone, nextServiceDate, reminderType
}: ServiceReminderEmailInput): Promise<SendEmailResult | SkippedResult> => {
  if (!customerEmail) {
    log.info('Skipping email — no customer email', { customerName, vehiclePlate });
    return { skipped: true, reason: 'no_email' };
  }

  const dateStr = new Date(nextServiceDate).toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });

  const typeLabels: Record<string, string> = {
    periodic_service: 'Periodic Service',
    oil_change: 'Oil Change',
    tire_rotation: 'Tire Rotation',
    inspection: 'Inspection',
    custom: 'Service'
  };
  const serviceLabel = typeLabels[reminderType] || 'Service';

  const subject = `🔧 ${serviceLabel} Reminder — ${vehiclePlate} | ${garageName}`;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:32px auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
    <!-- Header -->
    <tr>
      <td style="background:linear-gradient(135deg,#3b5ff8,#7c3aed);padding:32px 40px;text-align:center;">
        <h1 style="color:#ffffff;margin:0;font-size:24px;font-weight:700;">${garageName}</h1>
        <p style="color:rgba(255,255,255,0.8);margin:8px 0 0;font-size:14px;">Service Reminder</p>
      </td>
    </tr>
    <!-- Body -->
    <tr>
      <td style="padding:36px 40px;">
        <p style="font-size:16px;color:#1e293b;margin:0 0 20px;">
          Hi <strong>${customerName}</strong>,
        </p>
        <p style="font-size:15px;color:#475569;line-height:1.6;margin:0 0 24px;">
          This is a friendly reminder that your vehicle is due for its next
          <strong>${serviceLabel.toLowerCase()}</strong>. Keeping up with regular maintenance
          helps ensure your vehicle runs smoothly and safely.
        </p>

        <!-- Vehicle Card -->
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;border-radius:8px;margin-bottom:24px;">
          <tr>
            <td style="padding:20px 24px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="width:50%;padding:4px 0;">
                    <span style="font-size:12px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;">Vehicle</span><br/>
                    <span style="font-size:16px;font-weight:700;color:#1e293b;">${vehiclePlate}</span>
                  </td>
                  <td style="width:50%;padding:4px 0;">
                    <span style="font-size:12px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;">Make / Model</span><br/>
                    <span style="font-size:14px;color:#334155;">${vehicleMake} ${vehicleModel}</span>
                  </td>
                </tr>
                <tr>
                  <td colspan="2" style="padding:8px 0 0;">
                    <span style="font-size:12px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;">Service Due</span><br/>
                    <span style="font-size:15px;font-weight:600;color:#ea580c;">${dateStr}</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>

        <p style="font-size:15px;color:#475569;line-height:1.6;margin:0 0 28px;">
          Please call us at <strong>${garagePhone}</strong> or visit our workshop to schedule
          your appointment at a convenient time.
        </p>

        <!-- CTA Button -->
        <table cellpadding="0" cellspacing="0" style="margin:0 auto;">
          <tr>
            <td style="background:linear-gradient(135deg,#3b5ff8,#2540ed);border-radius:8px;">
              <a href="tel:${garagePhone}" style="display:inline-block;padding:14px 36px;color:#ffffff;font-weight:600;font-size:15px;text-decoration:none;">
                📞 Call to Book Now
              </a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    <!-- Footer -->
    <tr>
      <td style="background:#f8fafc;padding:20px 40px;border-top:1px solid #e2e8f0;text-align:center;">
        <p style="font-size:12px;color:#94a3b8;margin:0;">
          Sent by ${garageName} via GaragePulse CRM<br/>
          You are receiving this because your vehicle is registered with us.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = `Hi ${customerName},\n\nThis is a reminder that your vehicle ${vehiclePlate} (${vehicleMake} ${vehicleModel}) is due for a ${serviceLabel.toLowerCase()} on ${dateStr}.\n\nPlease contact ${garageName} at ${garagePhone} to schedule your appointment.\n\nThank you!`;

  return sendEmail({ to: customerEmail, subject, html, text });
};

interface EstimationEmailInput {
  customerName: string;
  customerEmail?: string;
  vehiclePlate: string;
  vehicleMake: string;
  vehicleModel: string;
  jobCardNumber: string;
  complaints: { description: string }[];
  grandTotal: number;
  garageName: string;
  garagePhone: string;
  approvalLink: string;
}

// ───── Estimation Approval Email ─────
export const sendEstimationEmail = async ({
  customerName,
  customerEmail,
  vehiclePlate,
  vehicleMake,
  vehicleModel,
  jobCardNumber,
  complaints,
  grandTotal,
  garageName,
  garagePhone,
  approvalLink
}: EstimationEmailInput): Promise<SendEmailResult | SkippedResult> => {
  if (!customerEmail) {
    log.info('Skipping estimation email — no customer email', { customerName, vehiclePlate });
    return { skipped: true, reason: 'no_email' };
  }

  const subject = `Estimation Ready — ${vehiclePlate} | ${garageName}`;

  const complaintsHtml = complaints
    .map(c => `<li style="margin-bottom:6px;color:#475569;">${c.description}</li>`)
    .join('');

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:32px auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.07);">
    <!-- Header -->
    <tr>
      <td style="background:linear-gradient(135deg,#3b5ff8,#7c3aed);padding:36px 40px;text-align:center;">
        <p style="color:rgba(255,255,255,0.75);margin:0 0 6px;font-size:13px;letter-spacing:0.06em;text-transform:uppercase;">Service Estimation</p>
        <h1 style="color:#ffffff;margin:0;font-size:26px;font-weight:700;">${garageName}</h1>
      </td>
    </tr>
    <!-- Body -->
    <tr>
      <td style="padding:36px 40px;">
        <p style="font-size:16px;color:#1e293b;margin:0 0 8px;">Hi <strong>${customerName}</strong>,</p>
        <p style="font-size:15px;color:#475569;line-height:1.7;margin:0 0 28px;">
          We have prepared an estimation for your vehicle. Please review the details below and click the button to approve so we can begin work.
        </p>

        <!-- Job Card -->
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;border-radius:10px;margin-bottom:24px;">
          <tr><td style="padding:20px 24px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="width:50%;padding:4px 0;">
                  <span style="font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.06em;">Vehicle</span><br/>
                  <span style="font-size:17px;font-weight:700;color:#1e293b;">${vehiclePlate}</span>
                </td>
                <td style="width:50%;padding:4px 0;">
                  <span style="font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.06em;">Make / Model</span><br/>
                  <span style="font-size:14px;color:#334155;">${vehicleMake} ${vehicleModel}</span>
                </td>
              </tr>
              <tr>
                <td colspan="2" style="padding:12px 0 0;">
                  <span style="font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.06em;">Job Card</span><br/>
                  <span style="font-size:14px;font-weight:600;color:#3b5ff8;">${jobCardNumber}</span>
                </td>
              </tr>
            </table>
          </td></tr>
        </table>

        <!-- Complaints -->
        <p style="font-size:13px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:0.06em;margin:0 0 10px;">Service Requests</p>
        <ul style="margin:0 0 24px;padding-left:20px;">${complaintsHtml}</ul>

        <!-- Total -->
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#eff6ff;border:1.5px solid #bfdbfe;border-radius:10px;margin-bottom:32px;">
          <tr><td style="padding:18px 24px;">
            <span style="font-size:13px;color:#1d4ed8;">Estimated Total</span>
            <span style="float:right;font-size:22px;font-weight:800;color:#1d4ed8;">&#8377;${grandTotal.toLocaleString('en-IN')}</span>
          </td></tr>
        </table>

        <!-- CTA -->
        <table cellpadding="0" cellspacing="0" style="margin:0 auto 24px;">
          <tr>
            <td style="background:linear-gradient(135deg,#3b5ff8,#7c3aed);border-radius:10px;">
              <a href="${approvalLink}" style="display:inline-block;padding:16px 48px;color:#ffffff;font-weight:700;font-size:16px;text-decoration:none;letter-spacing:0.02em;">Review &amp; Approve Estimation</a>
            </td>
          </tr>
        </table>

        <p style="font-size:13px;color:#94a3b8;text-align:center;margin:0;">Or paste this link in your browser:<br/>
          <a href="${approvalLink}" style="color:#3b5ff8;word-break:break-all;">${approvalLink}</a>
        </p>
      </td>
    </tr>
    <!-- Footer -->
    <tr>
      <td style="background:#f8fafc;padding:20px 40px;border-top:1px solid #e2e8f0;text-align:center;">
        <p style="font-size:12px;color:#94a3b8;margin:0;">Questions? Call us at <strong>${garagePhone}</strong><br/>Sent by ${garageName} via GaragePulse CRM</p>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = `Hi ${customerName},\n\nWe have prepared an estimation for your vehicle ${vehiclePlate} (${vehicleMake} ${vehicleModel}).\n\nJob Card: ${jobCardNumber}\nEstimated Total: Rs.${grandTotal}\n\nPlease review and approve here:\n${approvalLink}\n\nQuestions? Call ${garageName} at ${garagePhone}.`;

  return sendEmail({ to: customerEmail, subject, html, text });
};
