import assert from 'node:assert/strict';
import { describe, it, type TestContext } from 'node:test';
import { connectGoogle } from '../web/identity';
import { preferredCalendar, rememberCalendar } from '../web/calendar-preference';

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
