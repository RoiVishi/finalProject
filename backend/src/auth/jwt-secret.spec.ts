import { ConfigService } from '@nestjs/config';
import { requireJwtSecret } from './jwt-secret';

/** NFR-SEC-1 / NFR-SEC-2: no JWT secret in the code, no silent fallback. */
describe('requireJwtSecret', () => {
  const cfg = (value?: string) => ({ get: () => value }) as unknown as ConfigService;
  const strong = 'a'.repeat(64);

  it('refuses to start without JWT_SECRET', () => {
    expect(() => requireJwtSecret(cfg(undefined))).toThrow(/JWT_SECRET must be set/);
  });

  it('refuses the old in-code placeholder', () => {
    expect(() => requireJwtSecret(cfg('dev-secret-change-me'))).toThrow();
  });

  it('refuses a secret shorter than 32 characters', () => {
    expect(() => requireJwtSecret(cfg('short-but-not-a-placeholder'))).toThrow();
  });

  it('returns a strong secret unchanged', () => {
    expect(requireJwtSecret(cfg(strong))).toBe(strong);
  });
});
