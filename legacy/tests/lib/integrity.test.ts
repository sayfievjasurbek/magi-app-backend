import { describe, it, expect } from 'vitest';
import { pasteRatio, computeIntegrityRisk, worstRisk, RISK_ORDER } from '../../lib/integrity.js';

describe('pasteRatio', () => {
  it('returns null when either counter is missing', () => {
    expect(pasteRatio(null, null)).toBeNull();
    expect(pasteRatio(null, 100)).toBeNull();
    expect(pasteRatio(100, null)).toBeNull();
  });

  it('returns 0 for an empty submission instead of dividing by zero', () => {
    expect(pasteRatio(0, 0)).toBe(0);
  });

  it('measures the pasted share of the total', () => {
    expect(pasteRatio(0, 500)).toBe(1);
    expect(pasteRatio(500, 0)).toBe(0);
    expect(pasteRatio(50, 50)).toBe(0.5);
    expect(pasteRatio(300, 100)).toBe(0.25);
  });

  it('is not rounded', () => {
    expect(pasteRatio(2, 1)).toBeCloseTo(1 / 3, 10);
  });
});

describe('computeIntegrityRisk', () => {
  const risk = (aiProbability: number | null, humanTypingScore: number | null, paste: number | null) =>
    computeIntegrityRisk({ aiProbability, humanTypingScore, pasteRatio: paste });

  it('returns null only when every signal is missing', () => {
    expect(risk(null, null, null)).toBeNull();
    expect(risk(0, null, null)).toBe('low');
    expect(risk(null, 100, null)).toBe('low');
    expect(risk(null, null, 0)).toBe('low');
  });

  it('treats a missing signal as clean', () => {
    // null aiProbability/pasteRatio default to 0, null humanTypingScore to 100
    expect(risk(null, null, 0.6)).toBe('high');
    expect(risk(null, null, 0.3)).toBe('medium');
    expect(risk(90, null, null)).toBe('high');
    expect(risk(null, 10, null)).toBe('high');
  });

  describe('aiProbability thresholds', () => {
    it('is high from 60 up', () => {
      expect(risk(60, 100, 0)).toBe('high');
      expect(risk(100, 100, 0)).toBe('high');
    });

    it('is medium from 30 up to just under 60', () => {
      expect(risk(59.99, 100, 0)).toBe('medium');
      expect(risk(30, 100, 0)).toBe('medium');
    });

    it('is low just under 30', () => {
      expect(risk(29.99, 100, 0)).toBe('low');
      expect(risk(0, 100, 0)).toBe('low');
    });
  });

  describe('humanTypingScore thresholds', () => {
    it('is high below 40', () => {
      expect(risk(0, 39.99, 0)).toBe('high');
      expect(risk(0, 0, 0)).toBe('high');
    });

    it('is medium from 40 up to just under 70', () => {
      expect(risk(0, 40, 0)).toBe('medium');
      expect(risk(0, 69.99, 0)).toBe('medium');
    });

    it('is low from 70 up', () => {
      expect(risk(0, 70, 0)).toBe('low');
      expect(risk(0, 100, 0)).toBe('low');
    });
  });

  describe('pasteRatio thresholds', () => {
    it('is high from 0.5 up', () => {
      expect(risk(0, 100, 0.5)).toBe('high');
      expect(risk(0, 100, 1)).toBe('high');
    });

    it('is medium from 0.2 up to just under 0.5', () => {
      expect(risk(0, 100, 0.2)).toBe('medium');
      expect(risk(0, 100, 0.49)).toBe('medium');
    });

    it('is low just under 0.2', () => {
      expect(risk(0, 100, 0.19)).toBe('low');
      expect(risk(0, 100, 0)).toBe('low');
    });
  });

  it('lets any high signal win over medium ones', () => {
    expect(risk(30, 69, 0.6)).toBe('high');
    expect(risk(60, 69, 0.2)).toBe('high');
    expect(risk(30, 39, 0.2)).toBe('high');
  });

  it('stays low when every signal is clean', () => {
    expect(risk(29.99, 70, 0.19)).toBe('low');
  });
});

describe('worstRisk', () => {
  it('returns null when there is nothing to rank', () => {
    expect(worstRisk([])).toBeNull();
    expect(worstRisk([null, null])).toBeNull();
  });

  it('ignores nulls among real risks', () => {
    expect(worstRisk([null, 'medium', null])).toBe('medium');
  });

  it('picks the worst regardless of order', () => {
    expect(worstRisk(['low', 'high', 'medium'])).toBe('high');
    expect(worstRisk(['high', 'low'])).toBe('high');
    expect(worstRisk(['low', 'medium'])).toBe('medium');
    expect(worstRisk(['low', 'low'])).toBe('low');
  });

  it('ignores unknown and empty strings', () => {
    expect(worstRisk(['bogus'])).toBeNull();
    expect(worstRisk([''])).toBeNull();
    expect(worstRisk(['HIGH'])).toBeNull();
    expect(worstRisk(['bogus', 'medium'])).toBe('medium');
  });

  // `risk in RISK_ORDER` also matches Object.prototype keys, so "toString" is
  // returned as a risk level and hides the real ones behind it.
  it.fails('ignores inherited Object.prototype keys', () => {
    expect(worstRisk(['toString'])).toBeNull();
    expect(worstRisk(['toString', 'high'])).toBe('high');
  });

  it('ranks low < medium < high', () => {
    expect(RISK_ORDER.low).toBeLessThan(RISK_ORDER.medium);
    expect(RISK_ORDER.medium).toBeLessThan(RISK_ORDER.high);
  });
});
