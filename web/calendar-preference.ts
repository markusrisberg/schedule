import type { OwnedCalendar } from './google-calendar';

const key = (account: string) => `schedule.calendar.${encodeURIComponent(account)}`;

export function preferredCalendar(account: string, calendars: OwnedCalendar[]): string {
  try {
    const id = localStorage.getItem(key(account));
    return id && calendars.some((calendar) => calendar.id === id) ? id : '';
  } catch {
    return '';
  }
}

export function rememberCalendar(account: string, id: string): void {
  try {
    if (id) localStorage.setItem(key(account), id);
    else localStorage.removeItem(key(account));
  } catch {
    // Storage may be disabled; the current selection still works.
  }
}
