import { ForbiddenException } from '@nestjs/common';
import { SavedLocationsService } from './saved-locations.service';

function makeAdmin(opts: { maybeSingle?: any; single?: any } = {}) {
  const q: any = {};
  ['select', 'eq', 'order', 'insert', 'update', 'delete'].forEach((m) => {
    q[m] = jest.fn(() => q);
  });
  q.maybeSingle = jest.fn(() => Promise.resolve(opts.maybeSingle ?? { data: null, error: null }));
  q.single = jest.fn(() => Promise.resolve(opts.single ?? { data: null, error: null }));
  q.then = (resolve: (v: any) => any) => resolve({ data: [], error: null });
  const from = jest.fn(() => q);
  return { from, q } as any;
}

const U = '11111111-1111-1111-1111-111111111111';
const L = '22222222-2222-2222-2222-222222222222';

describe('SavedLocationsService.create', () => {
  const interactions = { track: jest.fn() } as any;
  beforeEach(() => interactions.track.mockClear());

  it('rejects when body.user_id does not match the JWT user', async () => {
    const svc = new SavedLocationsService(makeAdmin(), interactions);
    await expect(
      svc.create(U, { user_id: 'someone-else', location_id: L } as any),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('is idempotent: returns the existing row without inserting', async () => {
    const existing = { id: 'x', user_id: U, location_id: L, created_at: 't' };
    const admin = makeAdmin({ maybeSingle: { data: existing, error: null } });
    const svc = new SavedLocationsService(admin, interactions);

    const res = await svc.create(U, { user_id: U, location_id: L } as any);

    expect(res).toEqual(existing);
    expect(admin.q.insert).not.toHaveBeenCalled();
    expect(interactions.track).toHaveBeenCalledWith(U, L, 'favorite');
  });

  it('inserts a new row when none exists yet', async () => {
    const created = { id: 'new', user_id: U, location_id: L, created_at: 't' };
    const admin = makeAdmin({ maybeSingle: { data: null, error: null }, single: { data: created, error: null } });
    const svc = new SavedLocationsService(admin, interactions);

    const res = await svc.create(U, { user_id: U, location_id: L } as any);

    expect(res).toEqual(created);
    expect(admin.q.insert).toHaveBeenCalledWith({ user_id: U, location_id: L });
  });
});
