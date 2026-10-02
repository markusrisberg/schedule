import Holidays from 'date-holidays';
import type { ScheduleRow } from './schedule';

export const TIME_ZONE = 'Europe/Stockholm';

export interface CalendarEvent {
  title: string;
  start: { date: string; time: string };
  end: { date: string; time: string };
  timeZone: typeof TIME_ZONE;
  description: string;
  location: string;
  kind: 'work' | 'special' | 'oncall';
}

function civilDate(date: string): Date {
  const parsed = new Date(`${date}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error(`Ogiltigt datum: ${date}.`);
  }
  return parsed;
}

function nextDate(date: string): string {
  const parsed = civilDate(date);
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().slice(0, 10);
}

function clock(time: string): string {
  return `${time.slice(0, 2)}:${time.slice(2)}`;
}

const stockholm = new Intl.DateTimeFormat('sv-SE', {
  timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
});

function localMinute(instant: number): string {
  const parts = Object.fromEntries(stockholm.formatToParts(instant).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function validateLocalTime(date: string, time: string): void {
  const target = `${date}T${time}`;
  const approximate = Date.parse(`${target}:00Z`);
  const offsets = new Set([-1, 0, 1].map((day) => {
    const instant = approximate + day * 86_400_000;
    return Date.parse(`${localMinute(instant)}:00Z`) - instant;
  }));
  const matches = [...offsets].filter((offset) => localMinute(approximate - offset) === target);
  if (matches.length !== 1) {
    throw new Error(`Tiden ${date} ${time} ${matches.length ? 'inträffar två gånger' : 'finns inte'} vid omställningen mellan sommar- och vintertid i Sverige. Filen kan inte importeras utan ett entydigt klockslag.`);
  }
}

export function rowsToEvents(rows: ScheduleRow[]): CalendarEvent[] {
  const holidays = new Holidays('SE', { timezone: TIME_ZONE, types: ['public'] });
  const publicDates = new Map<number, Set<string>>();
  const events: CalendarEvent[] = [];

  for (const row of rows) {
    const date = civilDate(row.date);
    for (const time of [row.start, row.end]) {
      if (time && !/^(?:[01]\d|2[0-3])[0-5]\d$/.test(time)) {
        throw new Error(`Ogiltig tid på ${row.date}. Tider ska vara 00:00–23:59.`);
      }
    }
    const working = row.code === '.TJG' || row.code === 'TJG';
    if (Boolean(row.start) !== Boolean(row.end) || (working && !row.start)) {
      throw new Error(`Start- eller sluttid saknas på ${row.date}.`);
    }
    if (!row.start || !row.end || !row.code) continue;
    if (row.start === row.end) throw new Error(`Passet på ${row.date} har samma start- och sluttid.`);

    const weekday = date.getUTCDay();
    const afternoon = Number(row.start) >= 1200;
    const mr = row.notes.includes('MR');
    let holiday = false;
    if (working) {
      const year = date.getUTCFullYear();
      let dates = publicDates.get(year);
      if (!dates) {
        dates = new Set(holidays.getHolidays(year)
          .filter((holiday) => holiday.type === 'public')
          .map((holiday) => holiday.date.slice(0, 10)));
        publicDates.set(year, dates);
      }
      holiday = dates.has(row.date);
      if (holiday && weekday !== 0 && !(weekday >= 1 && weekday <= 5 && !mr && afternoon)) continue;
    }

    const tomorrow = nextDate(row.date);
    const endDate = row.end < row.start ? tomorrow : row.date;
    validateLocalTime(row.date, clock(row.start));
    validateLocalTime(endDate, clock(row.end));
    let title = `Jobb (${row.code})`;
    if (working) title = Number(row.start) > 1400 ? 'Jobb kväll' : 'Jobb dag';
    const work: CalendarEvent = {
      title,
      start: { date: row.date, time: clock(row.start) },
      end: { date: endDate, time: clock(row.end) },
      timeZone: TIME_ZONE, description: `Vecka ${row.week}`, location: 'PÄS', kind: working ? 'work' : 'special'
    };
    events.push(work);
    if (working && afternoon && !mr && ([0, 5, 6].includes(weekday) || holiday) && endDate === row.date) {
      events.push({ ...work, title: 'Beredskap', kind: 'oncall', start: work.end, end: { date: tomorrow, time: '00:00' } });
    }
  }
  return events;
}
