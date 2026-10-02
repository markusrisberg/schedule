import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { execFileSync } from 'node:child_process';
import { rowsToEvents } from '../src/events';
import { extractRowsFromCsv, type ScheduleRow } from '../src/schedule';
import { rowsToCsv } from '../src/parse';

const row = (values: Partial<ScheduleRow> = {}): ScheduleRow => ({
  week: '35', date: '2026-08-28', day: 'Fre', start: '1500', end: '2300',
  code: '.TJG', timebreak: '0000', time: '0800', notes: '', ...values
});
const header = 'Vecka;Datum;Dag;Från;Till;Kod;Rast;Tid;Arbetsplats;Anteckningar;';
const csvRow = '35;2026-08-28;Fre;15:00;23:00;.TJG;00:00;08:00;;;';

describe('given the source schedule CSV format', () => {
  it('should read BOM, CRLF, escaped quotes, embedded delimiters and carried weeks without interpreting HTML', () => {
    const csv = '\ufeff"Personlig lista";"Schema"\r\n' + header + '\r\n'
      + '35;2026-08-28;Fre;15:00;23:00;.TJG;00:00;08:00;;"MR; ""text""\r\n<img src=x>";\r\n'
      + ';2026-08-29;Lör;07:00;16:00;.TJG;00:30;08:30;;;\r\n\r\n'
      + 'Saldoinformation\r\nTjänstetid;297:04;Beredskapstid;00:00;';
    const rows = extractRowsFromCsv(csv);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].notes, 'MR; "text" <img src=x>');
    assert.equal(rows[1].week, '35');
    assert.equal(rows[1].start, '0700');
    assert.deepEqual(rowsToEvents(rows).map((event) => event.title), ['Jobb kväll', 'Jobb dag']);
  });

  for (const malformed of [
    '35;2026-08-29;Lör;15:00',
    '35;not-a-date;Lör;15:00;23:00;.TJG;00:00;08:00;;;',
    '35;2026-08-29;Lör;15:00;23:00;.TJG;00:00;08:00;;;unexpected',
    '35;2026-08-29;Lör;15:00;23:00;.TJG;00:00;08:00;;"unclosed',
    'Something that is not the known footer'
  ]) {
    it(`should reject the whole preview after a malformed row: ${malformed}`, () => {
      assert.throws(() => rowsToEvents(extractRowsFromCsv(`${header}\n${csvRow}\n${malformed}`)), /CSV|schemarad/);
    });
  }

  it('should reject missing headers, empty schedules and calendar CSV as source files', () => {
    for (const csv of ['', header, rowsToCsv([row()]), '<html><table>Vecka Datum Anteckningar</table></html>']) {
      assert.throws(() => extractRowsFromCsv(csv), /schematabell|schemarader/);
    }
  });

  it('should reject malformed clock notation rather than removing all colons', () => {
    assert.throws(() => rowsToEvents(extractRowsFromCsv(`${header}\n${csvRow.replace('15:00', '15::00')}`)), /Ogiltig tid/);
  });

  it('should trim export code whitespace while preserving exact code identity', () => {
    const csv = `${header}\n${csvRow.replace('.TJG', '  .TJG  ')}\n${csvRow.replace('.TJG', '  UTB  ')}`;
    assert.deepEqual(rowsToEvents(extractRowsFromCsv(csv)).map((event) => event.title),
      ['Jobb kväll', 'Beredskap', 'Jobb (UTB)']);
  });
});

describe('given a qualifying afternoon shift', () => {
  for (const [date, tomorrow] of [
    ['2026-08-28', '2026-08-29'],
    ['2026-01-31', '2026-02-01'],
    ['2027-12-31', '2028-01-01'],
    ['2020-02-28', '2020-02-29']
  ]) {
    it(`should end on-call at midnight on ${tomorrow}`, () => {
      const events = rowsToEvents([row({ date })]);
      assert.deepEqual(events[1], {
        title: 'Beredskap', kind: 'oncall', start: { date, time: '23:00' },
        end: { date: tomorrow, time: '00:00' }, timeZone: 'Europe/Stockholm',
        description: 'Vecka 35', location: 'PÄS'
      });
    });
  }

  it('should serialize midnight as next-day 12 AM, never same-day noon', () => {
    assert.equal(rowsToCsv([row()]).split('\n')[2],
      'Beredskap,08/28/2026,11:00 PM,08/29/2026,12:00 AM,False,Vecka 35,PÄS,True');
  });

  for (const end of ['0000', '0700']) {
    it(`should carry overnight work ending ${end} into the next date without invalid on-call duration`, () => {
      const events = rowsToEvents([row({ date: '2027-12-31', start: '2200', end })]);
      assert.equal(events.length, 1);
      assert.equal(events[0].end.date, '2028-01-01');
      assert.equal(events[0].end.time, end === '0000' ? '00:00' : '07:00');
    });
  }
});

describe('given invalid schedule dates and intervals', () => {
  for (const values of [
    { date: '2026-02-29' }, { date: '2026-13-01' }, { date: '2026-04-31' },
    { start: '2400' }, { end: '2360' }, { start: '900' }, { end: '' },
    { start: '', end: '' }, { start: '2300' }
  ]) {
    it(`should reject ${JSON.stringify(values)} before offering any events`, () => {
      assert.throws(() => rowsToEvents([row(), row(values)]), /Ogiltig|saknas|samma start/);
    });
  }

  it('should reject nonexistent and ambiguous Stockholm times instead of guessing an instant', () => {
    assert.throws(() => rowsToEvents([row({ date: '2026-03-29', start: '0230', end: '0700' })]), /finns inte/);
    assert.throws(() => rowsToEvents([row({ date: '2026-10-25', start: '0230', end: '0700' })]), /två gånger/);
  });
});

describe('given coded shifts other than TJG', () => {
  for (const code of ['UPPDR', 'UTB', 'PSEM', 'XTJG', '.TJG-extra']) {
    for (const [date, start, end, notes] of [
      ['2026-04-03', '0700', '1600', ''],
      ['2026-04-03', '1500', '2300', 'MR'],
      ['2026-06-06', '1500', '2300', ''],
      ['2026-08-28', '1500', '2300', '']
    ]) {
      it(`should include ${code} on ${date} at ${start} unchanged without on-call`, () => {
        assert.deepEqual(rowsToEvents([row({ code, date, start, end, notes })]), [{
          title: `Jobb (${code})`, kind: 'special',
          start: { date, time: `${start.slice(0, 2)}:${start.slice(2)}` },
          end: { date, time: `${end.slice(0, 2)}:${end.slice(2)}` },
          timeZone: 'Europe/Stockholm', description: 'Vecka 35', location: 'PÄS'
        }]);
      });
    }
  }

  for (const [end, expected] of [['0000', '00:00'], ['0700', '07:00']]) {
    it(`should preserve special overnight shifts ending at ${expected}`, () => {
      const events = rowsToEvents([row({ code: 'UTB', date: '2027-12-31', start: '2200', end })]);
      assert.equal(events.length, 1);
      assert.deepEqual(events[0].end, { date: '2028-01-01', time: expected });
      assert.equal(events[0].title, 'Jobb (UTB)');
    });
  }

  it('should still reject invalid and ambiguous special shift intervals', () => {
    for (const values of [
      { start: '2400' }, { end: '' }, { start: '2300' },
      { date: '2026-03-29', start: '0230' }, { date: '2026-10-25', start: '0230' }
    ]) {
      assert.throws(() => rowsToEvents([row({ code: 'UTB', ...values })]), /Ogiltig|saknas|samma start|finns inte|två gånger/);
    }
  });

  it('should omit date-only rows and intervals without a code', () => {
    assert.deepEqual(rowsToEvents([
      row({ code: '', start: '', end: '' }), row({ code: 'LEDIG', start: '', end: '' }), row({ code: '' })
    ]), []);
  });
});

describe('given existing TJG, MR, title and Swedish holiday rules', () => {
  const scenarios: [Partial<ScheduleRow>, string[]][] = [
    [{ code: 'TJG' }, ['Jobb kväll', 'Beredskap']],
    [{ notes: 'MR' }, ['Jobb kväll']],
    [{ date: '2026-08-27' }, ['Jobb kväll']],
    [{ start: '1400' }, ['Jobb dag', 'Beredskap']],
    [{ start: '0700', end: '1600' }, ['Jobb dag']],
    [{ date: '2026-04-03', start: '0700', end: '1600' }, []],
    [{ date: '2026-04-03' }, ['Jobb kväll', 'Beredskap']],
    [{ date: '2026-04-03', notes: 'MR' }, []],
    [{ date: '2026-06-06' }, []],
    [{ date: '2026-05-24', start: '0700', end: '1600' }, ['Jobb dag']],
    [{ date: '2026-05-24', notes: 'MR' }, ['Jobb kväll']],
    [{ date: '2026-06-19', start: '0700', end: '1600' }, ['Jobb dag']]
  ];
  for (const [values, expected] of scenarios) {
    it(`should preserve filtering for ${JSON.stringify(values)}`, () => {
      assert.deepEqual(rowsToEvents([row(values)]).map((event) => event.title), expected);
    });
  }

  it('should apply Swedish holiday dates even when the host is east or west of Sweden', () => {
    const script = `const { rowsToEvents } = require('./src/events.ts');
      const rows = ${JSON.stringify([
        row({ date: '2026-04-03', start: '0700', end: '1600' }),
        row({ date: '2026-04-06', notes: 'MR' }),
        row({ date: '2026-08-28' })
      ])};
      process.stdout.write(JSON.stringify(rowsToEvents(rows).map(e => [e.title, e.start.date, e.end.date, e.end.time])));`;
    for (const TZ of ['America/Los_Angeles', 'Pacific/Auckland', 'UTC', 'Europe/Stockholm']) {
      const output = execFileSync(process.execPath, ['--import', 'tsx', '-e', script], { cwd: process.cwd(), env: { ...process.env, TZ }, encoding: 'utf8' });
      assert.deepEqual(JSON.parse(output), [
        ['Jobb kväll', '2026-08-28', '2026-08-28', '23:00'],
        ['Beredskap', '2026-08-28', '2026-08-29', '00:00']
      ], TZ);
    }
  });
});
