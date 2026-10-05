import type { CalendarEvent } from '../src/events';
import { eventCategory, type EventColorId, type EventColorPreferences } from './event-colors';

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.events.owned'
] as const;

export interface AccessToken {
  value: string;
  expiresAt: number;
}

export interface OwnedCalendar {
  id: string;
  name: string;
  primary: boolean;
}

class CalendarError extends Error {
  constructor(message: string, readonly uncertain = false) {
    super(message);
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readAccessToken(value: unknown): AccessToken {
  if (!record(value)) throw new CalendarError('Google skickade ett ogiltigt behörighetssvar.');
  if (value.error) {
    throw new CalendarError(value.error === 'access_denied'
      ? 'Anslutningen avbröts eller behörigheten nekades. Ingen ny anslutning gjordes.'
      : 'Google kunde inte ge åtkomst. Kontrollera appens OAuth-inställningar och försök ansluta igen.');
  }
  const scopes = typeof value.scope === 'string' ? value.scope.split(/\s+/) : [];
  if (!GOOGLE_SCOPES.every((scope) => scopes.includes(scope))) {
    throw new CalendarError('Båda kalenderbehörigheterna behövs. Anslut igen och godkänn båda.');
  }
  const seconds = typeof value.expires_in === 'number' || typeof value.expires_in === 'string'
    ? Number(value.expires_in) : NaN;
  if (typeof value.access_token !== 'string' || !value.access_token || !Number.isFinite(seconds) || seconds <= 0) {
    throw new CalendarError('Google skickade en ogiltig eller utgången åtkomsttoken. Anslut igen.');
  }
  return { value: value.access_token, expiresAt: Date.now() + seconds * 1000 };
}

export class GoogleCalendar {
  private ownedIds = new Set<string>();

  constructor(private readonly token: AccessToken) {}

  private async request(path: string, event?: CalendarEvent, colorId?: EventColorId): Promise<unknown> {
    const writing = event !== undefined;
    const recovery = writing
      ? 'Granska importresultatet och kontrollera kalendern innan du läser in filen på nytt.'
      : 'Anslut igen.';
    if (Date.now() >= this.token.expiresAt - 5000) {
      throw new CalendarError(`Google-anslutningen har gått ut. ${writing ? 'Den här händelsen skickades inte. ' : ''}${recovery}`);
    }
    let response: Response;
    try {
      response = await fetch(`https://www.googleapis.com/calendar/v3/${path}`, {
        method: writing ? 'POST' : 'GET',
        headers: {
          Authorization: `Bearer ${this.token.value}`,
          ...(writing ? { 'Content-Type': 'application/json' } : {})
        },
        body: event ? JSON.stringify({
          summary: event.title, location: event.location, description: event.description,
          visibility: 'private',
          ...(colorId ? { colorId } : {}),
          start: { dateTime: `${event.start.date}T${event.start.time}:00`, timeZone: event.timeZone },
          end: { dateTime: `${event.end.date}T${event.end.time}:00`, timeZone: event.timeZone }
        }) : undefined,
        signal: AbortSignal.timeout(30_000),
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error'
      });
    } catch {
      throw new CalendarError(writing
        ? 'Svaret från Google saknas. Händelsen kan ha skapats. Kontrollera kalendern innan du läser in filen igen.'
        : 'Kunde inte hämta kalendrar. Kontrollera anslutningen och anslut igen.', writing);
    }
    if (!response.ok) {
      if (writing && (response.status >= 500 || response.status === 408)) {
        throw new CalendarError('Google gav ett serverfel. Händelsen kan ha skapats. Kontrollera kalendern innan du läser in filen igen.', true);
      }
      const messages: Record<number, string> = {
        401: `Google-anslutningen har gått ut eller återkallats. ${recovery}`,
        403: 'Google nekade åtkomst. Kontrollera behörigheter, kalenderägare och eventuell API-kvot.',
        429: 'Googles anropsgräns har nåtts. Importen har stoppats utan automatiskt nytt försök.'
      };
      throw new CalendarError(messages[response.status] ?? `Google avvisade anropet (HTTP ${response.status}). Kontrollera kalendern och appens inställningar.`);
    }
    try {
      return await response.json();
    } catch {
      throw new CalendarError(writing
        ? 'Google bekräftade inte händelsen med ett läsbart svar. Den kan ha skapats.'
        : 'Google skickade en oläsbar kalenderlista.', writing);
    }
  }

  async listOwnedCalendars(): Promise<{ account: string; calendars: OwnedCalendar[] }> {
    this.ownedIds.clear();
    const calendars: OwnedCalendar[] = [];
    const pageTokens = new Set<string>();
    let pageToken = '';
    do {
      const query = new URLSearchParams({ maxResults: '250', minAccessRole: 'owner' });
      if (pageToken) query.set('pageToken', pageToken);
      const page = await this.request(`users/me/calendarList?${query}`);
      if (!record(page) || (page.items !== undefined && !Array.isArray(page.items))) {
        throw new CalendarError('Google skickade en ogiltig kalenderlista. Anslut igen.');
      }
      for (const item of page.items ?? []) {
        if (!record(item) || typeof item.id !== 'string' || !item.id || typeof item.accessRole !== 'string') {
          throw new CalendarError('Google skickade en ofullständig kalenderlista. Anslut igen.');
        }
        if (item.accessRole !== 'owner' || item.deleted === true) continue;
        if (typeof item.summary !== 'string') throw new CalendarError('Ett kalendernamn saknas i Googles svar.');
        if (!calendars.some((calendar) => calendar.id === item.id)) {
          calendars.push({ id: item.id, name: item.summary, primary: item.primary === true });
        }
      }
      if (page.nextPageToken !== undefined && (typeof page.nextPageToken !== 'string' || !page.nextPageToken)) {
        throw new CalendarError('Google skickade en ogiltig sidmarkör för kalenderlistan.');
      }
      pageToken = typeof page.nextPageToken === 'string' ? page.nextPageToken : '';
      if (pageToken && pageTokens.has(pageToken)) throw new CalendarError('Google upprepade en sida i kalenderlistan. Anslut igen.');
      pageTokens.add(pageToken);
    } while (pageToken);
    const primary = calendars.filter((calendar) => calendar.primary);
    if (primary.length !== 1) throw new CalendarError('Kunde inte identifiera kontots primära kalender. Import är avstängd för att undvika fel konto.');
    this.ownedIds = new Set(calendars.map((calendar) => calendar.id));
    return { account: primary[0].id, calendars };
  }

  async insert(calendarId: string, event: CalendarEvent, colorId?: EventColorId): Promise<void> {
    if (!this.ownedIds.has(calendarId)) throw new CalendarError('Välj en kalender som det anslutna kontot äger.');
    const result = await this.request(`calendars/${encodeURIComponent(calendarId)}/events`, event, colorId);
    if (!record(result) || typeof result.id !== 'string' || !result.id || result.status === 'cancelled') {
      throw new CalendarError('Google bekräftade inte en skapad händelse. Den kan ändå ha skapats. Kontrollera kalendern.', true);
    }
  }
}

export type ImportStatus = 'excluded' | 'not-attempted' | 'sending' | 'success' | 'failed' | 'uncertain';
export interface ImportResult {
  status: ImportStatus;
  message?: string;
}

export class CalendarImport {
  private started = false;
  private colors?: EventColorPreferences;
  readonly results: ImportResult[];

  get sendsColors(): boolean { return this.colors?.sendColors ?? false; }

  constructor(private readonly events: CalendarEvent[]) {
    this.results = events.map(() => ({ status: 'excluded' }));
  }

  async run(google: GoogleCalendar, calendarId: string, selected: ReadonlySet<number>, changed: () => void, colors?: EventColorPreferences): Promise<void> {
    if (this.started) throw new CalendarError('Den här importen har redan startats. Läs bara in filen igen om du vill riskera dubbletter.');
    this.started = true;
    this.colors = colors ? { sendColors: colors.sendColors, colorIds: { ...colors.colorIds } } : undefined;
    const indices = this.events.map((_, index) => index).filter((index) => selected.has(index));
    for (const index of indices) this.results[index] = { status: 'not-attempted' };
    changed();
    for (const index of indices) {
      this.results[index] = { status: 'sending' };
      changed();
      try {
        const event = this.events[index];
        await google.insert(calendarId, event, this.colors?.sendColors ? this.colors.colorIds[eventCategory(event)] : undefined);
        this.results[index] = { status: 'success' };
      } catch (error) {
        this.results[index] = {
          status: error instanceof CalendarError && !error.uncertain ? 'failed' : 'uncertain',
          message: error instanceof CalendarError ? error.message : 'Utfallet är okänt. Kontrollera kalendern innan du läser in filen igen.'
        };
        changed();
        return;
      }
      changed();
    }
  }
}
