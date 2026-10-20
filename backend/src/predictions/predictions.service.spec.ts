import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { PredictionsService } from './predictions.service';

/** NFR-SEC-5 (KAN-129): every call to the AI service carries the shared secret. */
describe('PredictionsService', () => {
  const cfg = (values: Record<string, string>) =>
    ({ get: (key: string, fallback?: string) => values[key] ?? fallback }) as unknown as ConfigService;

  afterEach(() => jest.restoreAllMocks());

  it('sends AI_SERVICE_TOKEN in the X-Internal-Token header', async () => {
    const post = jest.spyOn(axios, 'post').mockResolvedValue({ data: [] });
    const svc = new PredictionsService(cfg({ AI_SERVICE_URL: 'http://ai:8001', AI_SERVICE_TOKEN: 'secret-123' }));

    await svc.predictProject({} as never);

    expect(post).toHaveBeenCalledWith(
      'http://ai:8001/predict/project',
      {},
      expect.objectContaining({ headers: { 'X-Internal-Token': 'secret-123' } }),
    );
  });

  it('a 401 from the AI service degrades to "no prediction", like any outage', async () => {
    const err = Object.assign(new Error('Request failed with status code 401'), {
      isAxiosError: true,
      response: { status: 401, data: { detail: 'missing or invalid service token' } },
    });
    jest.spyOn(axios, 'post').mockRejectedValue(err);
    const svc = new PredictionsService(cfg({ AI_SERVICE_TOKEN: 'wrong' }));

    await expect(svc.predictProject({} as never)).resolves.toBeNull();
  });
});
