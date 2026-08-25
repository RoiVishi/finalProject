import { createHash, randomBytes } from 'crypto';

/**
 * One-time tokens (password reset — AUTH-7, invitations — AUTH-4).
 * The raw value is handed to the user; only its hash is ever persisted, so a
 * database leak cannot be replayed.
 */
export const newToken = () => randomBytes(32).toString('hex');

export const hashToken = (raw: string) =>
  createHash('sha256').update(raw).digest('hex');
