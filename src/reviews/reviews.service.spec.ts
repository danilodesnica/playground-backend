import { ForbiddenException } from '@nestjs/common';
import { ReviewsService } from './reviews.service';

function makeAdmin(opts: { single?: any } = {}) {
  const q: any = {};
  ['select', 'eq', 'order', 'insert', 'update', 'delete'].forEach((m) => {
    q[m] = jest.fn(() => q);
  });
  q.maybeSingle = jest.fn(() => Promise.resolve({ data: null, error: null }));
  q.single = jest.fn(() => Promise.resolve(opts.single ?? { data: null, error: null }));
  const from = jest.fn(() => q);
  return { from, q } as any;
}

const U = '11111111-1111-1111-1111-111111111111';
const L = '22222222-2222-2222-2222-222222222222';

describe('ReviewsService.create', () => {
  it('rejects when user_id does not match the JWT user', async () => {
    const svc = new ReviewsService(makeAdmin());
    await expect(
      svc.create(U, { user_id: 'other', location_id: L, rating: 5 } as any),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('stores empty string when review text is omitted (rating-only review)', async () => {
    const created = { id: 'r', created_at: 0, user_id: U, location_id: L, review: '', rating: 5, status: 'pending' };
    const admin = makeAdmin({ single: { data: created, error: null } });
    const svc = new ReviewsService(admin);

    await svc.create(U, { user_id: U, location_id: L, rating: 5 } as any);

    expect(admin.q.insert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: U, location_id: L, review: '', rating: 5 }),
    );
  });
});
