import crypto from 'crypto';

export const newDataKey = (): Buffer => crypto.randomBytes(32);

/** AES-256-GCM. Output is base64(iv12 | ciphertext | tag16). */
export const wrapKey = (key: Buffer, master: Buffer): string => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', master, iv);
  const body = Buffer.concat([cipher.update(key), cipher.final()]);
  return Buffer.concat([iv, body, cipher.getAuthTag()]).toString('base64');
};

export const unwrapKey = (wrapped: string, master: Buffer): Buffer => {
  const raw = Buffer.from(wrapped, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', master, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(raw.length - 16));
  return Buffer.concat([decipher.update(raw.subarray(12, raw.length - 16)), decipher.final()]);
};

export const newRefreshToken = (): string => crypto.randomBytes(32).toString('base64url');

export const hashToken = (token: string): string => crypto.createHash('sha256').update(token).digest('hex');
