import { AdminUsersQuerySchema } from './admin-users-query.dto';

describe('AdminUsersQuerySchema — member directory list', () => {
  it('applies defaults when the query is empty', () => {
    const result = AdminUsersQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(50);
      expect(result.data.offset).toBe(0);
      expect(result.data.search).toBeUndefined();
    }
  });

  it('coerces limit/offset from the querystring', () => {
    const result = AdminUsersQuerySchema.safeParse({
      limit: '25',
      offset: '100',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(25);
      expect(result.data.offset).toBe(100);
    }
  });

  it('trims the search term', () => {
    const result = AdminUsersQuerySchema.safeParse({ search: '  ada  ' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.search).toBe('ada');
  });

  it('caps limit at 200 and forbids limit below 1', () => {
    expect(AdminUsersQuerySchema.safeParse({ limit: '201' }).success).toBe(
      false,
    );
    expect(AdminUsersQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
  });

  it('forbids a negative offset and non-integer values', () => {
    expect(AdminUsersQuerySchema.safeParse({ offset: '-1' }).success).toBe(
      false,
    );
    expect(AdminUsersQuerySchema.safeParse({ limit: '2.5' }).success).toBe(
      false,
    );
  });
});
