import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CalendarImport, GoogleCalendar, readAccessToken } from '../web/google-calendar';
import { rowsToEvents } from '../src/events';
import type { EventColorPreferences } from '../web/event-colors';

const granted = {
  access_token: 'test-token', expires_in: 3600,
  scope: 'https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.events.owned'
};
const primary = { id: 'person@example.test', summary: 'Person', primary: true, accessRole: 'owner' };
const work = { id: 'work/#@example.test', summary: 'Jobb', accessRole: 'owner' };
const events = rowsToEvents([
  { week: '35', date: '2026-08-28', day: 'Fre', start: '1500', end: '2300', code: '.TJG', notes: '', timebreak: '', time: '' },
  { week: '36', date: '2026-08-31', day: 'Mån', start: '0700', end: '1600', code: '.TJG', notes: '', timebreak: '', time: '' }
]);
const json = (body: unknown) => Response.json(body);

describe('given Google authorization responses', () => {
  it('should accept a scoped short-lived token and calculate its expiry', () => {
    const now = Date.now();
    const token = readAccessToken(granted);
    assert.equal(token.value, 'test-token');
    assert.ok(token.expiresAt >= now + 3_600_000 && token.expiresAt <= Date.now() + 3_600_000);
  });

  for (const [response, expected] of [
    [{ error: 'access_denied' }, /nekades/],
    [{ ...granted, scope: 'https://www.googleapis.com/auth/calendar.calendarlist.readonly' }, /Båda/],
    [{ ...granted, expires_in: 0 }, /ogiltig|utgången/],
    [{ ...granted, access_token: '' }, /ogiltig/],
    [null, /ogiltigt/]
  ] as const) {
    it(`should reject authorization response ${JSON.stringify(response)}`, () => {
      assert.throws(() => readAccessToken(response), expected);
    });
  }
});

describe('given a connected Google account', () => {
  it('should paginate, filter ownership and derive identity from the primary calendar rather than the first result', async (t) => {
    const urls: URL[] = [];
    t.mock.method(globalThis, 'fetch', async (input: string, init: RequestInit) => {
      urls.push(new URL(input));
      assert.equal(init.method, 'GET');
      assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer test-token');
      assert.equal(init.credentials, 'omit');
      return urls.length === 1
        ? json({ items: [work, { id: 'shared', summary: 'Delad', accessRole: 'writer' }], nextPageToken: 'page/2' })
        : json({ items: [primary] });
    });
    const google = new GoogleCalendar(readAccessToken(granted));
    assert.deepEqual(await google.listOwnedCalendars(), {
      account: 'person@example.test',
      calendars: [
        { id: work.id, name: 'Jobb', primary: false },
        { id: primary.id, name: 'Person', primary: true }
      ]
    });
    assert.equal(urls.length, 2);
    assert.equal(urls[1].searchParams.get('pageToken'), 'page/2');
    assert.equal(urls[0].searchParams.get('minAccessRole'), 'owner');
  });

  for (const payload of [
    { items: [work] }, { items: [{ ...primary, id: 123 }] },
    { items: 'bad' }, { items: [primary], nextPageToken: 1 }
  ]) {
    it(`should block import when the calendar list cannot safely identify ownership: ${JSON.stringify(payload)}`, async (t) => {
      let calls = 0;
      t.mock.method(globalThis, 'fetch', async () => { calls += 1; return json(payload); });
      const google = new GoogleCalendar(readAccessToken(granted));
      await assert.rejects(google.listOwnedCalendars(), /Google|konto|kalender/);
      await assert.rejects(google.insert(primary.id, events[0]), /äger/);
      assert.equal(calls, 1);
    });
  }

  it('should reject a stale calendar belonging to an earlier account without making a write', async (t) => {
    const calls: string[] = [];
    t.mock.method(globalThis, 'fetch', async (_: string, init: RequestInit) => {
      calls.push(init.method!);
      return json({ items: [primary] });
    });
    const google = new GoogleCalendar(readAccessToken(granted));
    await google.listOwnedCalendars();
    await assert.rejects(google.insert(work.id, events[0]), /äger/);
    assert.deepEqual(calls, ['GET']);
  });

  it('should reject expired authorization before any request', async (t) => {
    let requests = 0;
    t.mock.method(globalThis, 'fetch', async () => { requests += 1; return json({}); });
    const google = new GoogleCalendar({ value: 'expired', expiresAt: Date.now() - 1 });
    await assert.rejects(google.listOwnedCalendars(), /gått ut/);
    assert.equal(requests, 0);
  });
});

describe('given selected calendar events', () => {
  for (const sendColors of [false, true]) {
    it(`should ${sendColors ? 'send chosen category colors' : 'omit colors'} and freeze settings for a sequential batch`, async (t) => {
      const shifts = rowsToEvents([
        { week: '41', date: '2026-10-05', day: 'Mån', start: '0700', end: '1600', code: '.TJG', notes: '', timebreak: '', time: '' },
        { week: '41', date: '2026-10-09', day: 'Fre', start: '1500', end: '2300', code: '.TJG', notes: '', timebreak: '', time: '' },
        { week: '41', date: '2026-10-08', day: 'Tor', start: '0800', end: '1530', code: 'UTB', notes: '', timebreak: '', time: '' }
      ]);
      let complete!: (response: Response) => void;
      const pending = new Promise<Response>((resolve) => { complete = resolve; });
      const writes: Record<string, unknown>[] = [];
      t.mock.method(globalThis, 'fetch', async (_: string, init: RequestInit) => {
        if (init.method === 'GET') return json({ items: [primary] });
        writes.push(JSON.parse(String(init.body)));
        return writes.length === 1 ? pending : json({ id: `created-${writes.length}` });
      });
      const google = new GoogleCalendar(readAccessToken(granted));
      await google.listOwnedCalendars();
      const preferences: EventColorPreferences = {
        sendColors, colorIds: { day: '11', evening: '9', oncall: '7', other: '3' }
      };
      const batch = new CalendarImport(shifts);
      const importing = batch.run(google, primary.id, new Set(shifts.map((_, index) => index)), () => {}, preferences);
      assert.equal(writes.length, 1);
      preferences.sendColors = !sendColors;
      preferences.colorIds.evening = '4';
      preferences.colorIds.oncall = '8';
      preferences.colorIds.other = '10';
      complete(json({ id: 'first-created' }));
      await importing;
      assert.deepEqual(writes.map((body) => body.summary), ['Jobb dag', 'Jobb kväll', 'Beredskap', 'Jobb (UTB)']);
      assert.deepEqual(writes.map((body) => body.colorId), sendColors ? ['11', '9', '7', '3'] : [undefined, undefined, undefined, undefined]);
      if (!sendColors) assert.ok(writes.every((body) => !Object.hasOwn(body, 'colorId')));
      assert.equal(batch.sendsColors, sendColors);
      assert.deepEqual(writes[2].start, { dateTime: '2026-10-09T23:00:00', timeZone: 'Europe/Stockholm' });
      assert.deepEqual(writes[2].end, { dateTime: '2026-10-10T00:00:00', timeZone: 'Europe/Stockholm' });
      assert.ok(writes.every((body) => body.visibility === 'private'));
    });
  }

  it('should insert only selected events sequentially with explicit Stockholm times and block repeat submission', async (t) => {
    let complete!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => { complete = resolve; });
    const writes: { url: string; body: unknown }[] = [];
    t.mock.method(globalThis, 'fetch', async (input: string, init: RequestInit) => {
      if (init.method === 'GET') return json({ items: [primary, work] });
      assert.equal(init.method, 'POST');
      writes.push({ url: input, body: JSON.parse(String(init.body)) });
      return writes.length === 1 ? pending : json({ id: 'second-created', status: 'confirmed' });
    });
    const google = new GoogleCalendar(readAccessToken(granted));
    await google.listOwnedCalendars();
    const batch = new CalendarImport(events);
    const selected = new Set([1, 2]);
    const importing = batch.run(google, work.id, selected, () => {});
    await assert.rejects(batch.run(google, work.id, selected, () => {}), /redan startats/);
    assert.equal(writes.length, 1, 'must await the first confirmation before sending the next event');
    assert.deepEqual(batch.results.map((result) => result.status), ['excluded', 'sending', 'not-attempted']);
    assert.deepEqual(writes[0], {
      url: 'https://www.googleapis.com/calendar/v3/calendars/work%2F%23%40example.test/events',
      body: {
        summary: 'Beredskap', location: 'PÄS', description: 'Vecka 35', visibility: 'private',
        start: { dateTime: '2026-08-28T23:00:00', timeZone: 'Europe/Stockholm' },
        end: { dateTime: '2026-08-29T00:00:00', timeZone: 'Europe/Stockholm' }
      }
    });
    complete(json({ id: 'first-created', status: 'confirmed' }));
    await importing;
    assert.equal(writes.length, 2);
    assert.deepEqual(batch.results.map((result) => result.status), ['excluded', 'success', 'success']);
    await assert.rejects(batch.run(google, work.id, selected, () => {}), /redan startats/);
    assert.equal(writes.length, 2);
  });

  const errors: [string, () => Response | Promise<Response>, string, RegExp?][] = [
    ['permission denial', () => new Response('', { status: 403 }), 'failed'],
    ['expired token', () => new Response('', { status: 401 }), 'failed', /Granska importresultatet och kontrollera kalendern/],
    ['quota', () => new Response('', { status: 429 }), 'failed'],
    ['server error', () => new Response('', { status: 503 }), 'uncertain'],
    ['network error', () => Promise.reject(new TypeError('network')), 'uncertain'],
    ['timeout', () => Promise.reject(new DOMException('timeout', 'TimeoutError')), 'uncertain'],
    ['unreadable confirmation', () => new Response('not JSON'), 'uncertain'],
    ['missing event confirmation', () => json({}), 'uncertain']
  ];
  for (const [name, response, expected, recoveryInstruction] of errors) {
    it(`should stop on ${name}, preserve successes and leave remaining events unattempted without retry`, async (t) => {
      let writes = 0;
      t.mock.method(globalThis, 'fetch', async (_: string, init: RequestInit) => {
        if (init.method === 'GET') return json({ items: [primary] });
        writes += 1;
        return writes === 1 ? json({ id: 'confirmed' }) : response();
      });
      const google = new GoogleCalendar(readAccessToken(granted));
      await google.listOwnedCalendars();
      const batch = new CalendarImport(events);
      await batch.run(google, primary.id, new Set([0, 1, 2]), () => {});
      assert.deepEqual(batch.results.map((result) => result.status), ['success', expected, 'not-attempted']);
      assert.ok(batch.results[1].message);
      if (recoveryInstruction) assert.match(batch.results[1].message, recoveryInstruction);
      assert.equal(writes, 2);
      await assert.rejects(batch.run(google, primary.id, new Set([0, 1, 2]), () => {}), /redan startats/);
      assert.equal(writes, 2);
    });
  }
});
