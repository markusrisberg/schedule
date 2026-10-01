import type { CalendarEvent } from '../src/events';

export interface AgendaSegment {
  eventIndex: number;
  start: CalendarEvent['start'];
  end: CalendarEvent['end'];
  continuation: boolean;
}

// UTC is only a coordinate system for civil dates, not the instants of the shifts.
function civil(date: string): Date { return new Date(`${date}T00:00:00Z`); }

function addDays(date: string, count: number): string {
  const result = civil(date);
  result.setUTCDate(result.getUTCDate() + count);
  return result.toISOString().slice(0, 10);
}

function monday(date: string): string {
  return addDays(date, -((civil(date).getUTCDay() + 6) % 7));
}

export function buildAgenda(events: readonly CalendarEvent[], requestedDate?: string) {
  if (!events.length) return undefined;
  const indexed = events.map((event, eventIndex) => ({ event, eventIndex }))
    .sort((a, b) => `${a.event.start.date}T${a.event.start.time}`.localeCompare(`${b.event.start.date}T${b.event.start.time}`) || a.eventIndex - b.eventIndex);
  const firstDate = indexed[0].event.start.date;
  let lastDate = firstDate;
  let lastCoveredDate = firstDate;
  for (const event of events) {
    if (event.end.date > lastDate) lastDate = event.end.date;
    const coveredEnd = event.end.time === '00:00' ? addDays(event.end.date, -1) : event.end.date;
    if (coveredEnd > lastCoveredDate) lastCoveredDate = coveredEnd;
  }
  const firstWeek = monday(firstDate);
  const lastWeek = monday(lastCoveredDate);
  const requestedWeek = monday(requestedDate ?? firstDate);
  let weekStart = requestedWeek;
  if (weekStart < firstWeek) weekStart = firstWeek;
  if (weekStart > lastWeek) weekStart = lastWeek;
  const weekEnd = addDays(weekStart, 6);
  const thursday = civil(addDays(weekStart, 3));
  const weekYear = thursday.getUTCFullYear();
  const yearStart = civil(`${weekYear.toString().padStart(4, '0')}-01-01`);
  const weekNumber = Math.ceil(((thursday.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  const days = Array.from({ length: 7 }, (_, offset) => {
    const date = addDays(weekStart, offset);
    return {
      date,
      segments: indexed.flatMap(({ event, eventIndex }): AgendaSegment[] => {
        if (event.start.date > date || event.end.date < date || (event.end.date === date && event.end.time === '00:00')) return [];
        return [{
          eventIndex,
          start: event.start.date === date ? event.start : { date, time: '00:00' },
          end: event.end.date === date ? event.end : { date: addDays(date, 1), time: '00:00' },
          continuation: event.start.date < date
        }];
      })
    };
  });
  return {
    weekStart, weekEnd, weekNumber, weekYear, firstWeek, lastWeek,
    previousWeek: weekStart > firstWeek ? addDays(weekStart, -7) : undefined,
    nextWeek: weekStart < lastWeek ? addDays(weekStart, 7) : undefined,
    range: { start: firstDate, end: lastDate }, days
  };
}
