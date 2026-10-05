import assert from 'node:assert/strict';
import { describe, it, type TestContext } from 'node:test';
import { connectGoogle } from '../web/identity';
import { preferredCalendar, rememberCalendar } from '../web/calendar-preference';
import { loadEventColors, saveEventColors } from '../web/event-colors';

function globalValue(t: TestContext, name: string, value: unknown): void {
  const previous = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, value });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, name, previous);
    else Reflect.deleteProperty(globalThis, name);
  });
}

describe('given a browser calendar preference', () => {
  it('should restore only a listed calendar for the connected account, never another account preference', (t) => {
    const saved = new Map<string, string>();
    globalValue(t, 'localStorage', {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => saved.set(key, value),
      removeItem: (key: string) => saved.delete(key)
    });
    const calendars = [{ id: 'work', name: 'Jobb', primary: false }];
    rememberCalendar('first@example.test', 'work');
    assert.equal(preferredCalendar('first@example.test', calendars), 'work');
    assert.equal(preferredCalendar('second@example.test', calendars), '');
    assert.equal(preferredCalendar('first@example.test', []), '');
    rememberCalendar('first@example.test', '');
    assert.equal(preferredCalendar('first@example.test', calendars), '');
  });

  it('should remain usable when browser storage is blocked', (t) => {
    globalValue(t, 'localStorage', {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); }
    });
    rememberCalendar('person', 'work');
    assert.equal(preferredCalendar('person', [{ id: 'work', name: 'Jobb', primary: false }]), '');
  });
});

describe('given browser-wide event color preferences', () => {
  const defaults = { sendColors: false, colorIds: { day: '2', evening: '1', oncall: '5', other: '6' } };

  it('should save only color preferences separately from calendar preferences and restore them before connecting', (t) => {
    const saved = new Map<string, string>();
    globalValue(t, 'localStorage', {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => saved.set(key, value)
    });
    rememberCalendar('person@example.test', 'work');
    const preferences = loadEventColors();
    preferences.sendColors = true;
    preferences.colorIds = { day: '11', evening: '9', oncall: '7', other: '3' };
    assert.equal(saveEventColors(preferences), true);
    assert.deepEqual(JSON.parse(saved.get('schedule.event-colors.v1')!), {
      sendColors: true, colorIds: { day: '11', evening: '9', oncall: '7', other: '3' }
    });
    assert.deepEqual(loadEventColors(), preferences);
    assert.equal(preferredCalendar('person@example.test', [{ id: 'work', name: 'Jobb', primary: false }]), 'work');
    assert.equal(saved.size, 2);
  });

  for (const [name, saved, expected] of [
    ['absent', null, defaults],
    ['malformed JSON', '{', defaults],
    ['null', 'null', defaults],
    ['array', '[]', defaults],
    ['partial', JSON.stringify({ sendColors: true, colorIds: { day: '10' } }), { ...defaults, sendColors: true, colorIds: { ...defaults.colorIds, day: '10' } }],
    ['invalid IDs', JSON.stringify({ sendColors: 'true', colorIds: { day: 2, evening: '12', oncall: '#fbd75b', other: '4' } }), { ...defaults, colorIds: { ...defaults.colorIds, other: '4' } }],
    ['invalid color map', JSON.stringify({ sendColors: 1, colorIds: ['2'] }), defaults],
    ['saved opt-out', JSON.stringify({ sendColors: false, colorIds: { evening: '8' } }), { ...defaults, colorIds: { ...defaults.colorIds, evening: '8' } }]
  ] as const) {
    it(`should recover ${name} preferences without discarding valid category choices`, (t) => {
      globalValue(t, 'localStorage', { getItem: () => saved });
      assert.deepEqual(loadEventColors(), expected);
    });
  }

  it('should keep defaults independent of earlier in-memory changes when storage is blocked', (t) => {
    globalValue(t, 'localStorage', {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('quota'); }
    });
    const preferences = loadEventColors();
    assert.deepEqual(preferences, defaults);
    preferences.sendColors = true;
    preferences.colorIds.day = '11';
    assert.equal(saveEventColors(preferences), false);
    assert.equal(preferences.sendColors, true);
    assert.equal(preferences.colorIds.day, '11');
    assert.deepEqual(loadEventColors(), defaults);
  });

  it('should tolerate failure while accessing localStorage itself', (t) => {
    globalValue(t, 'localStorage', undefined);
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: () => { throw new Error('SecurityError'); } });
    const preferences = loadEventColors();
    assert.deepEqual(preferences, defaults);
    assert.equal(saveEventColors(preferences), false);
  });
});

describe('given Google Identity Services popup authorization', () => {
  it('should open the account picker in the calling gesture and request only the two owned-calendar scopes', async (t) => {
    let requested = false;
    globalValue(t, 'window', { google: { accounts: { oauth2: {
      initTokenClient: (config: {
        client_id: string; scope: string; include_granted_scopes: boolean; callback: (response: unknown) => void;
      }) => {
        assert.equal(config.client_id, 'public-client-id');
        assert.equal(config.scope, 'https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.events.owned');
        assert.equal(config.include_granted_scopes, false);
        return { requestAccessToken: (options: { prompt: string }) => {
          requested = true;
          assert.equal(options.prompt, 'select_account');
          config.callback({ access_token: 'token', expires_in: 3600, scope: config.scope });
        } };
      }
    } } } });
    const connecting = connectGoogle('public-client-id');
    assert.equal(requested, true);
    assert.equal((await connecting).value, 'token');
  });

  for (const [type, message] of [['popup_closed', /stängdes/], ['popup_failed_to_open', /blockerade/]] as const) {
    it(`should report ${type} in Swedish without keeping authorization pending`, async (t) => {
      globalValue(t, 'window', { google: { accounts: { oauth2: {
        initTokenClient: (config: { error_callback: (error: { type: string }) => void }) => ({
          requestAccessToken: () => config.error_callback({ type })
        })
      } } } });
      await assert.rejects(connectGoogle('client'), message);
    });
  }
});
