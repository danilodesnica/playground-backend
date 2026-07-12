import { HttpException } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import type { EventsBatchDto } from './dto/events-batch.dto';

describe('AnalyticsService — ingest rate limit', () => {
  const makeService = () => {
    const supabase = { auth: { getUser: jest.fn() } };
    const admin = {
      from: jest.fn(() => ({ insert: jest.fn().mockResolvedValue({ error: null }) })),
      rpc: jest.fn(),
    };
    // Structural fakes; the service only touches auth.getUser / from().insert here.
    // Inflation overlay is unused on the ingest path, so a bare stub suffices.
    const inflation = {};
    return new AnalyticsService(supabase as never, admin as never, inflation as never);
  };

  const batch: EventsBatchDto = {
    anonId: 'install-abc123',
    sessionId: 'sess-xyz789',
    events: [{ event: 'app_open', ts: Date.now() }],
  } as EventsBatchDto;

  it('accepts up to 60 batches per minute per IP, then returns 429', async () => {
    const service = makeService();

    for (let i = 0; i < 60; i++) {
      await expect(service.ingest(batch, undefined, '1.2.3.4')).resolves.toEqual({ accepted: 1 });
    }

    const blocked = service.ingest(batch, undefined, '1.2.3.4');
    await expect(blocked).rejects.toBeInstanceOf(HttpException);
    await expect(blocked).rejects.toHaveProperty('status', 429);
  });

  it('tracks IPs independently', async () => {
    const service = makeService();

    for (let i = 0; i < 61; i++) {
      await service.ingest(batch, undefined, '1.2.3.4').catch(() => undefined);
    }
    await expect(service.ingest(batch, undefined, '5.6.7.8')).resolves.toEqual({ accepted: 1 });
  });

  it('resets the window after a minute', async () => {
    jest.useFakeTimers();
    try {
      const service = makeService();

      for (let i = 0; i < 61; i++) {
        await service.ingest(batch, undefined, '1.2.3.4').catch(() => undefined);
      }
      await expect(service.ingest(batch, undefined, '1.2.3.4')).rejects.toBeInstanceOf(
        HttpException,
      );

      jest.advanceTimersByTime(60_001);
      await expect(service.ingest(batch, undefined, '1.2.3.4')).resolves.toEqual({ accepted: 1 });
    } finally {
      jest.useRealTimers();
    }
  });
});
