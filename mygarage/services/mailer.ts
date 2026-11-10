import nodemailer from 'nodemailer';

type InviteMail = { to: string; inviterName: string; garageName: string; role: 'editor' | 'viewer'; link: string; expiresAt: Date };

/** True when the SMTP settings an invite needs are present. Read at call time, so a restart is not needed. */
export const mailerReady = (): boolean => Boolean(process.env.SMTP_HOST && process.env.SMTP_USER);

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

const istFormat = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true
});

/** "12 Mar 2027, 5:30 pm" from the en-IN parts, so the wording does not depend on ICU's glue text. */
const istText = (d: Date): string => {
  const p = Object.fromEntries(istFormat.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.day} ${p.month} ${p.year}, ${p.hour}:${p.minute} ${String(p.dayPeriod).toLowerCase()}`;
};

export const sendInviteMail = async (mail: InviteMail): Promise<void> => {
  const port = Number(process.env.SMTP_PORT) || 587;
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
  const access = mail.role === 'editor' ? 'edit access' : 'view-only access';
  const intro = (who: string, garage: string): string => `${who} invited you to their garage "${garage}" on MyGarage, with ${access}.`;
  const tail = (to: string): string =>
    `This link works only for the Google account ${to}, and expires at ${istText(mail.expiresAt)} IST. ` +
    "If you don't have MyGarage yet, the link opens the Play Store. After installing, sign in with this Google account and the invite will be waiting in the app.";
  const e = escapeHtml;
  await transport.sendMail({
    from: `MyGarage <${process.env.SMTP_USER}>`,
    to: mail.to,
    subject: `${mail.inviterName} invited you to ${mail.garageName} on MyGarage`,
    text: `${intro(mail.inviterName, mail.garageName)}\n\nOpen the invite on your Android phone:\n${mail.link}\n\n${tail(mail.to)}`,
    html: `<p>${e(intro(mail.inviterName, mail.garageName))}</p><p>Open the invite on your Android phone:<br><a href="${e(mail.link)}">${e(mail.link)}</a></p><p>${e(tail(mail.to))}</p>`
  });
};
