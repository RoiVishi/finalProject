import { ArgumentMetadata, BadRequestException } from '@nestjs/common';
import { INVALID_ID_MESSAGE, isUuid, requireUuid, UuidPipe } from './uuid';

const meta: ArgumentMetadata = { type: 'param', data: 'id' };

describe('uuid ids - malformed values are 400, not 500', () => {
  const ok = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';

  it.each([undefined, null, 42, '', 'not-a-uuid', [ok, ok], `${ok}x`])('rejects %p', (v) => {
    expect(isUuid(v)).toBe(false);
    expect(() => requireUuid(v)).toThrow(BadRequestException);
  });

  it('accepts a uuid', () => {
    expect(requireUuid(ok)).toBe(ok);
  });

  it('UuidPipe answers 400 with the Hebrew message', async () => {
    await expect(UuidPipe.transform('abc', meta)).rejects.toThrow(INVALID_ID_MESSAGE);
    await expect(UuidPipe.transform(ok, meta)).resolves.toBe(ok);
  });
});
