import { describe, expect, it } from 'vitest';
import {
  STATUSES,
  applicationsSent,
  responseRate,
  type StatusCounts,
} from '../src/shared/index';

function counts(overrides: Partial<StatusCounts> = {}): StatusCounts {
  const base = Object.fromEntries(STATUSES.map((s) => [s, 0])) as StatusCounts;
  return { ...base, ...overrides };
}

describe('applicationsSent', () => {
  it('counts every status that means the application went out', () => {
    expect(
      applicationsSent(
        counts({ applied: 2, screening: 1, interview: 1, offer: 1, rejected: 3 }),
      ),
    ).toBe(8);
  });

  it('ignores saved and withdrawn, which may never have been sent', () => {
    expect(applicationsSent(counts({ saved: 4, withdrawn: 2 }))).toBe(0);
  });
});

describe('responseRate', () => {
  it('is null when nothing has been sent, not NaN', () => {
    expect(responseRate(counts())).toBeNull();
    expect(responseRate(counts({ saved: 5, withdrawn: 1 }))).toBeNull();
  });

  it('counts a rejection as a reply', () => {
    // 4 sent: 1 still waiting, 1 screening, 2 rejected -> 3 replies.
    expect(responseRate(counts({ applied: 1, screening: 1, rejected: 2 }))).toBe(0.75);
  });

  it('is zero when everything is still waiting', () => {
    expect(responseRate(counts({ applied: 10 }))).toBe(0);
  });

  it('is one when every sent application has been answered', () => {
    expect(responseRate(counts({ interview: 2, offer: 1 }))).toBe(1);
  });
});
