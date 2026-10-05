import type { CalendarEvent } from '../src/events';

// Google event colors (not calendar colors):
// https://developers.google.com/workspace/calendar/api/v3/reference/mcp/tools_list/list_events
// Presentation values follow colors.get; Google clients/themes may render differently.
// https://developers.google.com/workspace/calendar/api/v3/reference/colors
export const eventPalette = [
  { id: '1', name: 'Lavendel', hex: '#a4bdfc' },
  { id: '2', name: 'Salvia', hex: '#7ae7bf' },
  { id: '3', name: 'Druva', hex: '#dbadff' },
  { id: '4', name: 'Flamingo', hex: '#ff887c' },
  { id: '5', name: 'Banan', hex: '#fbd75b' },
  { id: '6', name: 'Mandarin', hex: '#ffb878' },
  { id: '7', name: 'Påfågel', hex: '#46d6db' },
  { id: '8', name: 'Grafit', hex: '#e1e1e1' },
  { id: '9', name: 'Blåbär', hex: '#5484ed' },
  { id: '10', name: 'Basilika', hex: '#51b749' },
  { id: '11', name: 'Tomat', hex: '#dc2127' }
] as const;

export type EventColorId = typeof eventPalette[number]['id'];
export const eventCategories = [
  { key: 'day', name: 'Jobb dag' },
  { key: 'evening', name: 'Jobb kväll' },
  { key: 'oncall', name: 'Beredskap' },
  { key: 'other', name: 'Övriga arbetspass' }
] as const;
export type EventCategory = typeof eventCategories[number]['key'];
export interface EventColorPreferences {
  sendColors: boolean;
  colorIds: Record<EventCategory, EventColorId>;
}

export function eventCategory(event: CalendarEvent): EventCategory {
  if (event.kind === 'oncall') return 'oncall';
  if (event.kind === 'special') return 'other';
  return event.title === 'Jobb dag' ? 'day' : 'evening';
}

const storageKey = 'schedule.event-colors.v1';

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function loadEventColors(): EventColorPreferences {
  let saved: unknown;
  try { saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null'); }
  catch { saved = null; }
  const preferences = record(saved) ? saved : {};
  const colors = record(preferences.colorIds) ? preferences.colorIds : {};
  const colorIds: Record<EventCategory, EventColorId> = { day: '2', evening: '1', oncall: '5', other: '6' };
  for (const category of eventCategories) {
    colorIds[category.key] = eventPalette.find((color) => color.id === colors[category.key])?.id ?? colorIds[category.key];
  }
  return { sendColors: preferences.sendColors === true, colorIds };
}

export function saveEventColors(preferences: EventColorPreferences): boolean {
  try {
    localStorage.setItem(storageKey, JSON.stringify(preferences));
    return true;
  } catch {
    return false;
  }
}
