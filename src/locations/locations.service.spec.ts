import { LocationsService } from './locations.service';

// Minimal chainable Supabase mock: every builder method returns the same object,
// terminal `.maybeSingle()/.single()` resolve to a configured result, and the
// builder itself is awaitable (resolves to `thenable`) for queries ending in `.limit()`.
function makeAdmin(opts: { thenable?: any; maybeSingle?: any; single?: any } = {}) {
  const q: any = {};
  ['select', 'or', 'eq', 'overlaps', 'gte', 'lte', 'order', 'limit', 'insert', 'update', 'delete'].forEach(
    (m) => {
      q[m] = jest.fn(() => q);
    },
  );
  q.maybeSingle = jest.fn(() => Promise.resolve(opts.maybeSingle ?? { data: null, error: null }));
  q.single = jest.fn(() => Promise.resolve(opts.single ?? { data: null, error: null }));
  q.then = (resolve: (v: any) => any) => resolve(opts.thenable ?? { data: [], error: null });
  const from = jest.fn(() => q);
  return { from, q } as any;
}

const interactions = { track: jest.fn() } as any;

describe('LocationsService.findFiltered geo bounds', () => {
  it('uses the real viewport box (padded) when deltas are provided', async () => {
    const admin = makeAdmin();
    const svc = new LocationsService(admin, interactions);

    await svc.findFiltered({ latitude: -33.86, longitude: 151.2, latitudeDelta: 0.1, longitudeDelta: 0.1 });

    const half = (0.1 * 1.15) / 2; // VIEWPORT_PAD = 1.15
    expect(admin.q.gte).toHaveBeenCalledWith('latitude', expect.closeTo(-33.86 - half, 6));
    expect(admin.q.lte).toHaveBeenCalledWith('latitude', expect.closeTo(-33.86 + half, 6));
    expect(admin.q.gte).toHaveBeenCalledWith('longitude', expect.closeTo(151.2 - half, 6));
    expect(admin.q.lte).toHaveBeenCalledWith('longitude', expect.closeTo(151.2 + half, 6));
    expect(admin.q.limit).toHaveBeenCalled();
  });

  it('falls back to the legacy ±0.03 box when no deltas (old App Store builds)', async () => {
    const admin = makeAdmin();
    const svc = new LocationsService(admin, interactions);

    await svc.findFiltered({ latitude: -33.86, longitude: 151.2 });

    expect(admin.q.gte).toHaveBeenCalledWith('latitude', expect.closeTo(-33.89, 6));
    expect(admin.q.lte).toHaveBeenCalledWith('latitude', expect.closeTo(-33.83, 6));
    expect(admin.q.gte).toHaveBeenCalledWith('longitude', expect.closeTo(151.17, 6));
    expect(admin.q.lte).toHaveBeenCalledWith('longitude', expect.closeTo(151.23, 6));
  });

  it('applies no geo bounds for the list view (no lat/lng)', async () => {
    const admin = makeAdmin();
    const svc = new LocationsService(admin, interactions);

    await svc.findFiltered({ type: 'all' });

    expect(admin.q.gte).not.toHaveBeenCalled();
    expect(admin.q.lte).not.toHaveBeenCalled();
  });
});
