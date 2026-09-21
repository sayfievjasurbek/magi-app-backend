import { describe, it, expect } from 'vitest';
import { average, fullName } from '../../lib/stats.js';

describe('average', () => {
  it('returns null for no values', () => {
    expect(average([])).toBeNull();
  });

  it('averages the values', () => {
    expect(average([5])).toBe(5);
    expect(average([1, 2])).toBe(1.5);
    expect(average([10, 20, 30])).toBe(20);
    expect(average([-1, -2])).toBe(-1.5);
  });

  it('rounds to two decimals', () => {
    expect(average([1, 2, 2])).toBe(1.67);
    expect(average([1, 1, 2])).toBe(1.33);
    expect(average([0.1, 0.2])).toBe(0.15);
  });

  it('keeps a zero average', () => {
    expect(average([0, 0])).toBe(0);
    expect(average([-5, 5])).toBe(0);
  });
});

describe('fullName', () => {
  it('joins both names', () => {
    expect(fullName({ first_name: 'Ada', last_name: 'Lovelace' })).toBe('Ada Lovelace');
  });

  it('drops a missing last name without a trailing space', () => {
    expect(fullName({ first_name: 'Ada', last_name: null })).toBe('Ada');
    expect(fullName({ first_name: 'Ada', last_name: '' })).toBe('Ada');
  });
});
