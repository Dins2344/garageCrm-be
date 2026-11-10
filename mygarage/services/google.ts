import { OAuth2Client } from 'google-auth-library';
import { HttpError } from '../../utils/httpError';

const client = new OAuth2Client();

/** Verifies a Google id token for our web client id. Any failure is one plain 401. */
export const verifyGoogleIdToken = async (idToken: string, audience: string): Promise<{ sub: string; email: string; name: string | null }> => {
  try {
    const ticket = await client.verifyIdToken({ idToken, audience });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email || payload.email_verified !== true) throw new Error('incomplete token');
    return { sub: payload.sub, email: payload.email, name: payload.name?.trim() || null };
  } catch {
    throw new HttpError('Google sign-in failed. Try again.', 401);
  }
};
