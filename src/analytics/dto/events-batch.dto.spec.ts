import { EventsBatchSchema } from './events-batch.dto';

describe('EventsBatchSchema — analytics ingest payload', () => {
  const validEvent = {
    event: 'screen_view',
    screen: '/discover',
    ts: 1751760000000,
    props: { source: 'tab_bar' },
  };

  it('accepts the batch shape the mobile tracker sends', () => {
    const body = {
      anonId: 'install-abc123',
      sessionId: 'sess-xyz789',
      appVersion: '1.0.16',
      platform: 'ios',
      osVersion: '18.5',
      deviceModel: 'iPhone16,2',
      events: [
        validEvent,
        { event: 'location_view', ts: 1751760001000, props: { location_id: 'a-uuid' } },
        { event: 'app_open', ts: 1751760002000 }, // screen/props optional
      ],
    };

    const result = EventsBatchSchema.safeParse(body);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.anonId).toBe('install-abc123');
      expect(result.data.events).toHaveLength(3);
    }
  });

  it('rejects a batch with more than 50 events', () => {
    const body = {
      anonId: 'install-abc123',
      sessionId: 'sess-xyz789',
      events: Array.from({ length: 51 }, () => validEvent),
    };

    const result = EventsBatchSchema.safeParse(body);
    expect(result.success).toBe(false);
  });

  it('rejects a batch missing anonId', () => {
    const body = {
      sessionId: 'sess-xyz789',
      events: [validEvent],
    };

    const result = EventsBatchSchema.safeParse(body);
    expect(result.success).toBe(false);
  });
});
