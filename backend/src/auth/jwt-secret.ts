import { ConfigService } from '@nestjs/config';

/** The placeholder that used to be the silent fallback; never accepted again. */
const KNOWN_PLACEHOLDERS = new Set(['dev-secret-change-me', 'changeme', 'secret']);
const MIN_LENGTH = 32;

/**
 * NFR-SEC-1 / NFR-SEC-2: the JWT signing secret comes from the environment
 * only. There is no fallback — with a known default in the code, anyone who
 * reads the repository can forge a token for any user. The backend refuses
 * to start instead.
 */
export function requireJwtSecret(cfg: ConfigService): string {
  const secret = cfg.get<string>('JWT_SECRET');
  if (!secret || KNOWN_PLACEHOLDERS.has(secret) || secret.length < MIN_LENGTH) {
    throw new Error(
      `JWT_SECRET must be set to a random value of at least ${MIN_LENGTH} characters ` +
      '(e.g. `openssl rand -hex 32`). See README → "Running locally".',
    );
  }
  return secret;
}
