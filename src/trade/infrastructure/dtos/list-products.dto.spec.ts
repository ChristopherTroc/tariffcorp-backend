import { plainToInstance } from 'class-transformer';
import { ListProductsDto } from './list-products.dto';

describe('ListProductsDto has_findings transform', () => {
  function transform(value: unknown) {
    return plainToInstance(ListProductsDto, { has_findings: value })
      .has_findings;
  }

  it('coerces string "true" and boolean true', () => {
    expect(transform('true')).toBe(true);
    expect(transform(true)).toBe(true);
  });

  it('coerces string "false" and boolean false', () => {
    expect(transform('false')).toBe(false);
    expect(transform(false)).toBe(false);
  });

  it('returns undefined for other values', () => {
    expect(transform('yes')).toBeUndefined();
    expect(transform(1)).toBeUndefined();
    expect(transform(undefined)).toBeUndefined();
  });
});
