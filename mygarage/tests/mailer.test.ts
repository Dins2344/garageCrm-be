import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import nodemailer from 'nodemailer';
import { mailerReady, sendInviteMail } from '../services/mailer';

const sendMail = vi.fn(async (_m: Record<string, string>) => undefined);
const mail = {
  to: 'anu@gmail.com', inviterName: 'Dinson <b>', garageName: 'Cars & "bikes"', role: 'editor' as const,
  link: 'https://dctech.space/api/mygarage/invite/abc', expiresAt: new Date('2027-03-12T12:00:00Z')
};
const saved = { ...process.env };

beforeEach(() => {
  sendMail.mockClear();
  vi.spyOn(nodemailer, 'createTransport').mockReturnValue({ sendMail } as unknown as ReturnType<typeof nodemailer.createTransport>);
  process.env.SMTP_HOST = 'smtp.test';
  process.env.SMTP_USER = 'gp@test.dev';
  process.env.SMTP_PASS = 'pw';
  delete process.env.SMTP_PORT;
});
afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...saved };
});

describe('MyGarage mailer', () => {
  it('is ready only with SMTP_HOST and SMTP_USER', () => {
    expect(mailerReady()).toBe(true);
    delete process.env.SMTP_HOST;
    expect(mailerReady()).toBe(false);
    process.env.SMTP_HOST = 'smtp.test';
    delete process.env.SMTP_USER;
    expect(mailerReady()).toBe(false);
  });

  it('uses port 587 by default and secure only on 465', async () => {
    await sendInviteMail(mail);
    expect(nodemailer.createTransport).toHaveBeenLastCalledWith(expect.objectContaining({ host: 'smtp.test', port: 587, secure: false }));
    process.env.SMTP_PORT = '465';
    await sendInviteMail(mail);
    expect(nodemailer.createTransport).toHaveBeenLastCalledWith(expect.objectContaining({ port: 465, secure: true }));
    process.env.SMTP_PORT = '2525';
    await sendInviteMail(mail);
    expect(nodemailer.createTransport).toHaveBeenLastCalledWith(expect.objectContaining({ port: 2525, secure: false }));
  });

  it('sends the exact subject and text, an escaped HTML part with the button, from MyGarage', async () => {
    await sendInviteMail(mail);
    const sent = sendMail.mock.calls[0][0];
    expect(sent.from).toBe('MyGarage <gp@test.dev>');
    expect(sent.to).toBe('anu@gmail.com');
    expect(sent.subject).toBe('Dinson <b> invited you to Cars & "bikes" on MyGarage');
    expect(sent.text).toBe(
      'Dinson <b> invited you to their garage "Cars & "bikes"" on MyGarage, with edit access.\n\n' +
      'Open the invite on your Android phone:\nhttps://dctech.space/api/mygarage/invite/abc\n\n' +
      'This link works only for the Google account anu@gmail.com, and expires at 12 Mar 2027, 5:30 pm IST. ' +
      "If you don't have MyGarage yet, the link opens the Play Store. After installing, sign in with this Google account and the invite will be waiting in the app."
    );
    expect(sent.html).toContain('Dinson &lt;b&gt; invited you to their garage &quot;Cars &amp; &quot;bikes&quot;&quot;');
    expect(sent.html).not.toContain('<b>');
    expect(sent.html).toMatch(/<a href="https:\/\/dctech\.space\/api\/mygarage\/invite\/abc"[^>]*>Open in MyGarage<\/a>/);
    await sendInviteMail({ ...mail, role: 'viewer' });
    expect(sendMail.mock.calls[1][0].text).toContain('with view-only access.');
  });
});
