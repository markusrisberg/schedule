import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CalendarEvent } from '../src/events';
import { buildAgenda } from '../web/agenda';

function shift(date: string, start = '08:00', end = '16:00', endDate = date): CalendarEvent {
  return {
    title: 'Jobb dag', kind: 'work', location: 'PÄS', description: '', timeZone: 'Europe/Stockholm',
    start: { date, time: start }, end: { date: endDate, time: end }
  };
}

describe('given a file with events in nonchronological order', () => {
  describe('when opening its agenda', () => {
    it('should start on the earliest week, lay out Monday through Sunday and preserve source identities', () => {
      const events = [shift('2026-11-02'), shift('2026-10-25'), shift('2026-10-19', '15:00', '22:00'), shift('2026-10-19')];
      const original = structuredClone(events);
      const agenda = buildAgenda(events)!;
      assert.equal(agenda.weekStart, '2026-10-19');
      assert.equal(agenda.weekEnd, '2026-10-25');
      assert.deepEqual(agenda.days.map((day) => day.date), [
        '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25'
      ]);
      assert.deepEqual(agenda.days.map((day) => day.segments.map((segment) => segment.eventIndex)), [[3, 2], [], [], [], [], [], [1]]);
      assert.deepEqual(events, original);
    });
  });
});

describe('given overnight and coincident events', () => {
  describe('when inspecting both sides of a week boundary', () => {
    it('should retain one identity per logical event, with no midnight-only segment', () => {
      const events = [
        shift('2026-10-25', '22:00', '06:00', '2026-10-26'),
        shift('2026-10-25', '23:00', '00:00', '2026-10-26'),
        shift('2026-10-25', '22:00', '06:00', '2026-10-26')
      ];
      const sunday = buildAgenda(events)!.days[6].segments;
      assert.deepEqual(sunday.map((segment) => segment.eventIndex), [0, 2, 1]);
      assert.deepEqual(sunday[0], {
        eventIndex: 0, start: { date: '2026-10-25', time: '22:00' },
        end: { date: '2026-10-26', time: '00:00' }, continuation: false
      });
      const nextWeek = buildAgenda(events, '2026-10-26')!;
      assert.deepEqual(nextWeek.days.flatMap((day) => day.segments), [
        { eventIndex: 0, start: { date: '2026-10-26', time: '00:00' }, end: { date: '2026-10-26', time: '06:00' }, continuation: true },
        { eventIndex: 2, start: { date: '2026-10-26', time: '00:00' }, end: { date: '2026-10-26', time: '06:00' }, continuation: true }
      ]);
    });
  });
});

describe('given a file spanning several weeks', () => {
  describe('when paging through its coverage', () => {
    it('should bound navigation by covered dates, allow empty gap weeks and retain the full file range', () => {
      const events = [shift('2026-11-08', '23:00', '00:00', '2026-11-09'), shift('2026-10-19')];
      const first = buildAgenda(events)!;
      assert.equal(first.firstWeek, '2026-10-19');
      assert.equal(first.lastWeek, '2026-11-02');
      assert.equal(first.previousWeek, undefined);
      assert.equal(first.nextWeek, '2026-10-26');
      assert.deepEqual(first.range, { start: '2026-10-19', end: '2026-11-09' });
      const gap = buildAgenda(events, first.nextWeek)!;
      assert.equal(gap.weekStart, '2026-10-26');
      assert.equal(gap.days.flatMap((day) => day.segments).length, 0);
      assert.equal(gap.previousWeek, '2026-10-19');
      assert.equal(gap.nextWeek, '2026-11-02');
      const last = buildAgenda(events, gap.nextWeek)!;
      assert.equal(last.nextWeek, undefined);
      assert.deepEqual(last.days[6].segments.map((segment) => segment.eventIndex), [0]);
      assert.equal(buildAgenda(events, '2025-01-01')!.weekStart, first.firstWeek);
      assert.equal(buildAgenda(events, '2027-01-01')!.weekStart, first.lastWeek);
      const overnight = buildAgenda([shift('2026-11-08', '23:00', '06:00', '2026-11-09')])!;
      assert.equal(overnight.lastWeek, '2026-11-09');
      assert.equal(overnight.nextWeek, '2026-11-09');
    });
  });
});

describe('given civil Swedish calendar dates', () => {
  describe('when finding weeks around year, leap-day and DST boundaries', () => {
    for (const example of [
      { date: '2021-01-01', start: '2020-12-28', end: '2021-01-03', week: 53, year: 2020 },
      { date: '2024-12-30', start: '2024-12-30', end: '2025-01-05', week: 1, year: 2025 },
      { date: '2024-02-29', start: '2024-02-26', end: '2024-03-03', week: 9, year: 2024 },
      { date: '2026-03-29', start: '2026-03-23', end: '2026-03-29', week: 13, year: 2026 },
      { date: '2026-10-25', start: '2026-10-19', end: '2026-10-25', week: 43, year: 2026 }
    ]) {
      it(`should place ${example.date} in its ISO week independently of the host timezone`, () => {
        const originalTimezone = process.env.TZ;
        try {
          for (const timezone of ['UTC', 'Europe/Stockholm', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
            process.env.TZ = timezone;
            const agenda = buildAgenda([shift(example.date)])!;
            assert.equal(agenda.weekStart, example.start);
            assert.equal(agenda.weekEnd, example.end);
            assert.equal(agenda.weekNumber, example.week);
            assert.equal(agenda.weekYear, example.year);
            assert.deepEqual(agenda.days.filter((day) => day.segments.length).map((day) => day.date), [example.date]);
          }
        } finally {
          if (originalTimezone === undefined) delete process.env.TZ;
          else process.env.TZ = originalTimezone;
        }
      });
    }
  });
});

describe('given an accepted file with no matching events', () => {
  describe('when opening the agenda', () => {
    it('should have no week to display or page through', () => {
      assert.equal(buildAgenda([]), undefined);
      assert.equal(buildAgenda([], '2026-10-19'), undefined);
    });
  });
});
