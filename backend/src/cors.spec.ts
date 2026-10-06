import { corsOrigins, DEFAULT_DEV_ORIGINS } from './cors';

/** NFR-SEC-1: an explicit CORS allow-list, never a wildcard. */
describe('corsOrigins', () => {
  it('allows only the local dev server when CORS_ORIGINS is unset', () => {
    expect(corsOrigins(undefined)).toEqual(DEFAULT_DEV_ORIGINS);
    expect(corsOrigins('  ')).toEqual(DEFAULT_DEV_ORIGINS);
  });

  it('parses a comma-separated list, trimming spaces and trailing slashes', () => {
    expect(corsOrigins('https://foresite.example.com/, http://localhost:5173'))
      .toEqual(['https://foresite.example.com', 'http://localhost:5173']);
  });

  it('refuses a wildcard', () => {
    expect(() => corsOrigins('*')).toThrow(/explicit origins/);
    expect(() => corsOrigins('https://a.example.com,*')).toThrow();
  });
});
