import { UpdateUserSchema } from './update-user.dto';

describe('UpdateUserSchema — member profile edit', () => {
  it('accepts a name on its own', () => {
    const result = UpdateUserSchema.safeParse({ name: 'Kate' });
    expect(result.success).toBe(true);
  });

  it('accepts a home postcode, trimmed', () => {
    const result = UpdateUserSchema.safeParse({ postCode: '  2204 ' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.postCode).toBe('2204');
  });

  it('accepts a name and postcode together', () => {
    const result = UpdateUserSchema.safeParse({ name: 'Kate', postCode: '2204' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('Kate');
      expect(result.data.postCode).toBe('2204');
    }
  });

  it('rejects an empty postcode rather than wiping the stored one', () => {
    expect(UpdateUserSchema.safeParse({ postCode: '' }).success).toBe(false);
    expect(UpdateUserSchema.safeParse({ postCode: '   ' }).success).toBe(false);
  });

  it('leaves postCode undefined when it is not sent, so a name-only edit does not touch it', () => {
    const result = UpdateUserSchema.safeParse({ name: 'Kate' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.postCode).toBeUndefined();
  });

  it('still enforces the 8 character password minimum', () => {
    expect(UpdateUserSchema.safeParse({ password: 'short' }).success).toBe(false);
    expect(UpdateUserSchema.safeParse({ password: 'longenough' }).success).toBe(true);
  });
});
