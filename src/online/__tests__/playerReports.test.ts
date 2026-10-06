import { describe, expect, it } from 'vitest';
import { getVisiblePlayerReport, reconcileSelectedReportPeriod, sortPlayerReports } from '../playerReports';

describe('player report navigation', () => {
  const reports = [
    { periodIndex: 1, report: 'one' },
    { periodIndex: 3, report: 'three' },
    { periodIndex: 2, report: 'two' },
  ];

  it('orders newest first and selects newest by default', () => {
    const ordered = sortPlayerReports(reports);
    expect(ordered.map(r => r.periodIndex)).toEqual([3, 2, 1]);
    expect(getVisiblePlayerReport(ordered, null)?.report).toBe('three');
  });

  it('keeps an older selection through polling but follows a newly arrived latest report', () => {
    const ordered = sortPlayerReports(reports);
    expect(reconcileSelectedReportPeriod(2, ordered, 3)).toBe(2);
    expect(reconcileSelectedReportPeriod(2, sortPlayerReports([...reports, { periodIndex: 4, report: 'four' }]), 3)).toBe(4);
  });
});
