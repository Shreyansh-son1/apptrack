import { describe, expect, it } from 'vitest';
import {
  ALLOWED_TRANSITIONS,
  canTransition,
  describeStatus,
  isFollowUpDue,
  STATUSES,
  type Status,
} from '../src/shared/index';

describe('status transitions', () => {
  it('allows the normal forward path', () => {
    expect(canTransition('saved', 'applied')).toBe(true);
    expect(canTransition('applied', 'screening')).toBe(true);
    expect(canTransition('screening', 'interview')).toBe(true);
    expect(canTransition('interview', 'offer')).toBe(true);
  });

  it('refuses to move backwards', () => {
    expect(canTransition('interview', 'applied')).toBe(false);
    expect(canTransition('offer', 'interview')).toBe(false);
  });

  it('treats rejected and withdrawn as terminal', () => {
    for (const status of STATUSES) {
      expect(canTransition('rejected', status)).toBe(status === 'rejected');
      expect(canTransition('withdrawn', status)).toBe(status === 'withdrawn');
    }
  });

  it('treats a no-op change as allowed', () => {
    for (const status of STATUSES) {
      expect(canTransition(status, status)).toBe(true);
    }
  });

  it('lets any live application be rejected or withdrawn', () => {
    const live: Status[] = ['saved', 'applied', 'screening', 'interview', 'offer'];
    for (const status of live) {
      expect(canTransition(status, 'withdrawn')).toBe(true);
    }
  });

  it('defines a transition list for every status', () => {
    // Guards against a status being added to STATUSES without a rule.
    for (const status of STATUSES) {
      expect(ALLOWED_TRANSITIONS[status]).toBeDefined();
    }
  });

  it('has a label for every status', () => {
    for (const status of STATUSES) {
      expect(describeStatus(status).length).toBeGreaterThan(0);
    }
  });
});

describe('follow-up due', () => {
  const base = { status: 'applied' } as const;

  it('is due when the date has passed', () => {
    expect(isFollowUpDue({ ...base, followUpOn: '2026-01-01' }, '2026-02-01')).toBe(true);
  });

  it('is due on the day itself', () => {
    expect(isFollowUpDue({ ...base, followUpOn: '2026-02-01' }, '2026-02-01')).toBe(true);
  });

  it('is not due in the future', () => {
    expect(isFollowUpDue({ ...base, followUpOn: '2026-03-01' }, '2026-02-01')).toBe(false);
  });

  it('is never due without a date', () => {
    expect(isFollowUpDue({ ...base, followUpOn: null }, '2026-02-01')).toBe(false);
  });

  it('is never due on a closed application', () => {
    expect(
      isFollowUpDue({ status: 'rejected', followUpOn: '2020-01-01' }, '2026-02-01'),
    ).toBe(false);
  });
});
