import { ForbiddenException } from '@nestjs/common';
import { UserService } from './user.service';

function makeAdmin(isAdmin: boolean) {
  const q: any = {};
  ['select', 'eq', 'update', 'delete'].forEach((m) => {
    q[m] = jest.fn(() => q);
  });
  // isAdmin() reads public.users.is_admin
  q.maybeSingle = jest.fn(() => Promise.resolve({ data: { is_admin: isAdmin }, error: null }));
  const from = jest.fn(() => q);
  return { from, q } as any;
}

const ME = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';

describe('UserService authorization', () => {
  it('forbids updating another user when caller is not admin', async () => {
    const svc = new UserService(makeAdmin(false));
    const jwtUser = { id: ME, app_metadata: {} } as any;
    await expect(svc.updateById(jwtUser, OTHER, { name: 'X' } as any)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('forbids deleting another user when caller is not admin', async () => {
    const svc = new UserService(makeAdmin(false));
    const jwtUser = { id: ME, app_metadata: {} } as any;
    await expect(svc.deleteById(jwtUser, OTHER)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
