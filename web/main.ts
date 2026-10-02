import { extractRowsFromCsv } from '../src/schedule';
import { rowsToEvents, type CalendarEvent } from '../src/events';
import { CalendarImport, GoogleCalendar, type ImportStatus, type OwnedCalendar } from './google-calendar';
import { connectGoogle, loadGoogleIdentity } from './identity';
import { preferredCalendar, rememberCalendar } from './calendar-preference';
import { ImportWizard, steps } from './wizard';
import { buildAgenda, type AgendaSegment } from './agenda';
import './style.css';

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing element: ${id}`);
  return found as T;
}

const fileInput = element<HTMLInputElement>('schedule-file');
const chooseFileButton = element<HTMLButtonElement>('choose-file');
const fileStatus = element('file-status');
const fileContext = element('file-context');
const agendaReview = element('agenda-review');
const agendaDays = element('agenda-days');
const previousWeekButton = element<HTMLButtonElement>('previous-week');
const nextWeekButton = element<HTMLButtonElement>('next-week');
const selectionCount = element('selection-count');
const resultList = element<HTMLTableSectionElement>('result-events');
const nextButton = element<HTMLButtonElement>('next');
const backButton = element<HTMLButtonElement>('back');
const wizardActions = element('wizard-actions');
const wizard = new ImportWizard();
const stepControls = steps.map((step) => ({
  step, button: element<HTMLButtonElement>(`step-${step}`), panel: element(`panel-${step}`)
}));
const connectButton = element<HTMLButtonElement>('connect');
const disconnectButton = element<HTMLButtonElement>('disconnect');
const calendarSelect = element<HTMLSelectElement>('calendar');
const importButton = element<HTMLButtonElement>('import');
const importStatus = element('import-status');
const fileError = element('file-error');
const connectionError = element('connection-error');
const importError = element('error');
const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim();

let events: CalendarEvent[] = [];
let fileName = '';
let selected = new Set<number>();
let batch: CalendarImport | undefined;
let google: GoogleCalendar | undefined;
let calendars: OwnedCalendar[] = [];
let account = '';
let googleReady = false;
let connecting = false;
let reading = false;
let importing = false;
let consumed = false;
let expiryTimer: number | undefined;
let agenda: ReturnType<typeof buildAgenda>;
let eventControls: { index: number; button: HTMLButtonElement; mark: HTMLElement }[] = [];
const resultControls = new Map<number, HTMLTableCellElement>();
const dateFormat = new Intl.DateTimeFormat('sv-SE', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const fullDateFormat = new Intl.DateTimeFormat('sv-SE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const weekdayFormat = new Intl.DateTimeFormat('sv-SE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

function busy(): boolean { return importing || connecting || reading; }

function refreshSteps(): void {
  fileContext.hidden = wizard.current === 'upload' || !fileName;
  for (const { step, button, panel } of stepControls) {
    const current = step === wizard.current;
    const wasHidden = panel.hidden;
    panel.hidden = !current;
    button.disabled = !wizard.canVisit(step);
    if (current) button.setAttribute('aria-current', 'step');
    else button.removeAttribute('aria-current');
    if (current && wasHidden) panel.focus();
  }
  wizardActions.hidden = wizard.current === 'upload';
  nextButton.hidden = wizard.current === 'upload' || wizard.current === 'import';
  nextButton.disabled = !wizard.canAdvance;
  backButton.hidden = wizard.current === 'upload';
  backButton.disabled = !wizard.canGoBack;
}

for (const { step, button } of stepControls) {
  button.addEventListener('click', () => { wizard.visit(step); refreshSteps(); });
}
nextButton.addEventListener('click', () => { wizard.advance(); refreshSteps(); });
backButton.addEventListener('click', () => { wizard.back(); refreshSteps(); });

function showError(target: HTMLElement, error?: unknown): void {
  target.textContent = error instanceof Error ? error.message : '';
  target.hidden = !error;
}

function refreshControls(): void {
  const locked = busy();
  chooseFileButton.disabled = fileInput.disabled = locked;
  connectButton.disabled = locked || consumed || !googleReady;
  disconnectButton.disabled = locked || consumed;
  disconnectButton.hidden = !google;
  calendarSelect.disabled = locked || consumed || !google;
  element('calendar-field').hidden = !google;
  connectButton.textContent = connecting ? 'Ansluter…' : google ? 'Byt konto / anslut igen' : 'Anslut Google';
  for (const { index, button, mark } of eventControls) {
    const chosen = selected.has(index);
    button.disabled = locked || consumed;
    button.setAttribute('aria-pressed', String(chosen));
    mark.textContent = chosen ? '✓' : '−';
  }
  previousWeekButton.disabled = locked || !agenda?.previousWeek;
  nextWeekButton.disabled = locked || !agenda?.nextWeek;
  const calendar = calendars.find((item) => item.id === calendarSelect.value);
  importButton.disabled = locked || consumed || !google || !calendar || selected.size === 0;
  element('review-locked').hidden = element('calendar-locked').hidden = !consumed;
  wizard.update({ hasParsedFile: Boolean(batch), hasSelection: selected.size > 0,
    hasCalendar: Boolean(google && calendar), busy: locked, consumed });
  refreshSteps();
  selectionCount.hidden = !events.length;
  selectionCount.textContent = `${selected.size} av ${events.length} valda i hela filen.${selected.size === 0 ? ' Välj minst en för att fortsätta.' : ''}`;
  if (!consumed) {
    element('import-target').textContent = calendar
      ? `${selected.size} händelser till ”${calendar.name}” · ${account}`
      : 'Välj händelser och anslut en kalender för att importera.';
    importButton.textContent = calendar ? `Importera ${selected.size} händelser till ”${calendar.name}”` : 'Importera till Google Kalender';
  }
}

function eventCells(event: CalendarEvent): HTMLTableCellElement[] {
  const date = document.createElement('td');
  const day = document.createElement('time');
  day.dateTime = day.title = event.start.date;
  const shortDate = document.createElement('span');
  shortDate.setAttribute('aria-hidden', 'true');
  shortDate.textContent = dateFormat.format(new Date(`${event.start.date}T12:00:00Z`));
  const fullDate = document.createElement('span');
  fullDate.className = 'sr-only';
  fullDate.textContent = event.start.date;
  day.append(shortDate, fullDate);
  date.append(day);
  const title = document.createElement('td');
  title.className = event.kind;
  title.textContent = event.title;
  const time = document.createElement('td');
  time.className = 'event-time';
  time.textContent = `${event.start.time}–${event.end.time}`;
  if (event.start.date !== event.end.date) {
    const nextDay = document.createElement('span');
    nextDay.className = 'next-day';
    nextDay.textContent = '+1';
    nextDay.title = `Slutar nästa dag, ${event.end.date}`;
    const explanation = document.createElement('span');
    explanation.className = 'sr-only';
    explanation.textContent = `, slutar nästa dag, ${event.end.date}`;
    nextDay.setAttribute('aria-hidden', 'true');
    time.append(nextDay, explanation);
  }
  return [date, title, time];
}

function agendaCard(segment: AgendaSegment): HTMLButtonElement {
  const index = segment.eventIndex;
  const event = events[index];
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `agenda-event ${event.kind}`;
  button.classList.toggle('day', event.kind === 'work' && event.title === 'Jobb dag');
  const original = `${event.title}, ${event.start.date} kl. ${event.start.time} till ${event.end.date} kl. ${event.end.time}, ${event.timeZone}`;
  button.title = original;
  button.setAttribute('aria-label', `${original}${event.start.date !== event.end.date ? ', slutar nästa dag, +1' : ''}${segment.continuation ? `, fortsättning på ${segment.start.date}` : ''}`);
  const mark = document.createElement('span');
  mark.className = 'agenda-choice';
  mark.setAttribute('aria-hidden', 'true');
  const copy = document.createElement('span');
  copy.className = 'agenda-event-copy';
  const title = document.createElement('strong');
  title.textContent = event.title;
  const interval = document.createElement('span');
  interval.className = 'agenda-interval';
  const start = segment.continuation ? segment.start : event.start;
  const end = segment.continuation ? segment.end : event.end;
  const startTime = document.createElement('time');
  startTime.dateTime = `${start.date}T${start.time}`;
  startTime.textContent = start.time;
  const endTime = document.createElement('time');
  endTime.dateTime = `${end.date}T${end.time}`;
  endTime.textContent = end.time;
  interval.append(startTime, '–', endTime);
  if (start.date !== end.date) interval.append(' +1');
  copy.append(title, interval);
  if (segment.continuation) {
    const continuation = document.createElement('span');
    continuation.className = 'agenda-continuation';
    continuation.textContent = `Fortsättning från ${event.start.date} kl. ${event.start.time}`;
    copy.append(continuation);
  }
  button.append(mark, copy);
  button.addEventListener('click', () => {
    if (busy() || consumed) return;
    if (selected.has(index)) selected.delete(index);
    else selected.add(index);
    refreshControls();
  });
  eventControls.push({ index, button, mark });
  return button;
}

function renderAgenda(): void {
  agendaDays.replaceChildren();
  eventControls = [];
  agendaReview.hidden = !agenda;
  if (agenda) {
    element('agenda-week').textContent = `Vecka ${agenda.weekNumber} · ${agenda.weekYear}`;
    const range = [agenda.weekStart, agenda.weekEnd].map((date) => {
      const time = document.createElement('time');
      time.dateTime = time.title = date;
      time.textContent = fullDateFormat.format(new Date(`${date}T00:00:00Z`));
      return time;
    });
    element('agenda-range').replaceChildren(range[0], ' – ', range[1]);
    for (const day of agenda.days) {
      const section = document.createElement('section');
      section.className = 'agenda-day';
      const date = document.createElement('div');
      date.className = 'agenda-date';
      date.setAttribute('aria-hidden', 'true');
      date.textContent = String(Number(day.date.slice(8)));
      const content = document.createElement('div');
      content.className = 'agenda-content';
      const heading = document.createElement('h3');
      heading.id = `agenda-day-${day.date}`;
      section.setAttribute('aria-labelledby', heading.id);
      const time = document.createElement('time');
      time.dateTime = time.title = day.date;
      time.textContent = weekdayFormat.format(new Date(`${day.date}T00:00:00Z`));
      heading.append(time);
      content.append(heading);
      for (const segment of day.segments) content.append(agendaCard(segment));
      if (!day.segments.length) {
        const empty = document.createElement('p');
        empty.className = 'agenda-empty';
        empty.textContent = 'Inga inlästa pass';
        content.append(empty);
      }
      section.append(date, content);
      agendaDays.append(section);
    }
  }
  element('empty-preview').hidden = events.length > 0;
  const confirmation = element('review-confirmation');
  confirmation.hidden = !events.length;
  const oncallCount = events.filter((event) => event.kind === 'oncall').length;
  const specialCount = events.filter((event) => event.kind === 'special').length;
  confirmation.textContent = `Filen har lästs in. ${events.length - oncallCount} arbetspass${oncallCount ? ` och ${oncallCount} beredskapspass` : ''}.`;
  if (specialCount) confirmation.textContent += ` ${specialCount} av arbetspassen har en annan kod än .TJG och visas i orange.`;
  refreshControls();
}

for (const [button, direction] of [[previousWeekButton, 'previousWeek'], [nextWeekButton, 'nextWeek']] as const) {
  button.addEventListener('click', () => {
    const date = agenda?.[direction];
    if (busy() || !date) return;
    const hadFocus = document.activeElement === button;
    agenda = buildAgenda(events, date);
    renderAgenda();
    if (hadFocus && button.disabled) element('agenda-week').focus();
  });
}

function clearSchedule(): void {
  events = [];
  fileName = '';
  selected.clear();
  agenda = undefined;
  batch = undefined;
  consumed = false;
  resultList.replaceChildren();
  resultControls.clear();
  element('results').hidden = true;
  importStatus.textContent = '';
  showError(fileError);
  showError(importError);
  renderAgenda();
}

chooseFileButton.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', async () => {
  if (busy()) return;
  const file = fileInput.files?.[0];
  fileInput.value = '';
  if (!file) return;
  if (consumed && !window.confirm('Du läser in en fil på nytt. Tidigare skapade händelser finns kvar och en ny import kan ge dubbletter. Fortsätta?')) return;
  const previousImport = consumed;
  reading = true;
  showError(fileError);
  fileStatus.textContent = 'Läser filen lokalt…';
  if (previousImport) refreshControls();
  else clearSchedule();
  try {
    if (!/\.csv$/i.test(file.name) || /\.ical\.csv$/i.test(file.name)) {
      throw new Error('Välj den ursprungliga CSV-exporten, inte HTML eller en .ical.csv-fil.');
    }
    if (file.size > 1024 * 1024) throw new Error('Filen är för stor. Välj en CSV-export på högst 1 MB med ett kortare schemaintervall.');
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()); }
    catch { throw new Error('Kunde inte läsa filen som UTF-8. Exportera schemat till CSV med UTF-8 och försök igen.'); }
    const parsedEvents = rowsToEvents(extractRowsFromCsv(text));
    if (previousImport) clearSchedule();
    events = parsedEvents;
    agenda = buildAgenda(events);
    fileName = file.name;
    element('file-name').textContent = fileName;
    element('file-summary').textContent = `${events.length} händelser${agenda ? ` · ${agenda.range.start} – ${agenda.range.end}` : ''}`;
    selected = new Set(events.map((_, index) => index));
    batch = new CalendarImport(events);
    fileStatus.textContent = `${fileName} · ${events.length} händelser, varav ${events.filter((event) => event.kind === 'oncall').length} beredskap.`;
    if (!events.length) fileStatus.textContent += ' Inga pass matchar reglerna för arbete.';
  } catch (error) {
    fileStatus.textContent = previousImport
      ? 'Den nya filen kunde inte läsas. Tidigare importresultat finns kvar i steget Importera.'
      : 'Filen kunde inte läsas. Ingen förhandsgranskning eller import har skapats.';
    showError(fileError, error);
    return;
  } finally {
    reading = false;
    renderAgenda();
  }
  wizard.visit('review');
  refreshSteps();
});

function clearConnection(): void {
  clearTimeout(expiryTimer);
  google = undefined;
  calendars = [];
  account = '';
  calendarSelect.replaceChildren(new Option('Välj kalender', ''));
}

connectButton.addEventListener('click', async () => {
  if (!clientId || busy() || consumed) return;
  clearConnection();
  connecting = true;
  showError(connectionError);
  refreshControls();
  try {
    const token = await connectGoogle(clientId);
    const connection = new GoogleCalendar(token);
    const result = await connection.listOwnedCalendars();
    google = connection;
    account = result.account;
    calendars = result.calendars;
    calendarSelect.replaceChildren(new Option('Välj kalender', ''), ...calendars.map((calendar) => new Option(`${calendar.name}${calendar.primary ? ' (primär)' : ''}`, calendar.id)));
    calendarSelect.value = preferredCalendar(account, calendars);
    expiryTimer = window.setTimeout(() => {
      clearConnection();
      showError(connectionError, new Error(consumed
        ? 'Google-anslutningen har gått ut. Resultatet och importmålet finns kvar i steget Importera. Den här importen kan inte skickas igen.'
        : 'Google-anslutningen har gått ut. Anslut igen. Dina lokala val finns kvar.'));
      refreshControls();
    }, Math.max(0, token.expiresAt - Date.now() - 5000));
  } catch (error) {
    clearConnection();
    showError(connectionError, error);
  } finally {
    connecting = false;
    refreshControls();
  }
});

disconnectButton.addEventListener('click', () => {
  if (busy() || consumed) return;
  clearConnection();
  showError(connectionError);
  refreshControls();
});

calendarSelect.addEventListener('change', () => {
  if (busy() || consumed) return;
  if (account) rememberCalendar(account, calendarSelect.value);
  refreshControls();
});

const statusLabels: Record<ImportStatus, string> = {
  excluded: 'Inte vald', 'not-attempted': 'Inte försökt', sending: 'Skickar…',
  success: 'Skapad', failed: 'Misslyckades', uncertain: 'Osäkert utfall'
};

function renderResults(): void {
  resultList.replaceChildren();
  resultControls.clear();
  for (const [index, event] of events.entries()) {
    if (!selected.has(index)) continue;
    const row = document.createElement('tr');
    const status = document.createElement('td');
    status.className = 'event-status';
    row.append(...eventCells(event), status);
    resultList.append(row);
    resultControls.set(index, status);
  }
  element('results').hidden = false;
}

function renderProgress(): void {
  if (!batch) return;
  for (const [index, result] of batch.results.entries()) {
    const status = resultControls.get(index);
    if (!status) continue;
    status.dataset.status = result.status;
    status.textContent = statusLabels[result.status];
    if (result.message) {
      status.setAttribute('aria-describedby', 'error');
      const event = events[index];
      showError(importError, new Error(`${event.start.date} ${event.title} kl. ${event.start.time}: ${result.message}`));
    }
  }
  const confirmed = batch.results.filter((result) => result.status === 'success').length;
  if (importing) {
    importStatus.textContent = `Importerar. ${confirmed} av ${selected.size} bekräftat skapade. Stäng inte sidan.`;
  } else {
    const stopped = batch.results.some((result) => result.status === 'failed' || result.status === 'uncertain');
    const summary = stopped ? 'Importen stoppades. Se resultatet vid varje händelse.' : 'Importen är klar.';
    importStatus.textContent = `${confirmed} av ${selected.size} bekräftat skapade. ${summary} Den här importen kan inte skickas igen.`;
  }
}

importButton.addEventListener('click', async () => {
  if (wizard.current !== 'import' || busy() || consumed || !google || !batch || !selected.size || !calendars.some((calendar) => calendar.id === calendarSelect.value)) return;
  consumed = true;
  importing = true;
  showError(importError);
  renderResults();
  refreshControls();
  try {
    await batch.run(google, calendarSelect.value, selected, renderProgress);
  } catch (error) {
    showError(importError, error);
  } finally {
    importing = false;
    renderProgress();
    refreshControls();
  }
});

window.addEventListener('beforeunload', (event) => {
  if (importing) { event.preventDefault(); event.returnValue = ''; }
});

if (clientId) {
  loadGoogleIdentity().then(() => {
    googleReady = true;
    refreshControls();
  }).catch((error: unknown) => {
    showError(connectionError, error);
  });
} else {
  showError(connectionError, new Error('Google-import är inte konfigurerad. Ange VITE_GOOGLE_CLIENT_ID vid byggandet enligt README. Du kan fortfarande läsa in och granska din CSV lokalt.'));
}

refreshControls();
