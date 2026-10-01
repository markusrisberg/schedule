import type { CalendarEvent } from './events';

export const CSV_HEADER = 'Subject,Start Date,Start Time,End Date,End Time,All Day Event,Description,Location,Private';

function formatDate(date: string): string {
  const [year, month, day] = date.split('-');
  return `${month}/${day}/${year}`;
}

function formatTime(time: string): string {
  const [hours, minutes] = time.split(':').map(Number);
  return `${String(hours % 12 || 12).padStart(2, '0')}:${String(minutes).padStart(2, '0')} ${hours >= 12 ? 'PM' : 'AM'}`;
}

function escapeField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function eventsToCsv(events: CalendarEvent[]): string {
  const lines = events.map((event) => [
    event.title, formatDate(event.start.date), formatTime(event.start.time),
    formatDate(event.end.date), formatTime(event.end.time), 'False',
    event.description, event.location, 'True'
  ].map(escapeField).join(','));
  return `${[CSV_HEADER, ...lines].join('\n')}\n`;
}
