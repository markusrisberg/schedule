import { GOOGLE_SCOPES, readAccessToken, type AccessToken } from './google-calendar';

interface GoogleIdentity {
  accounts: {
    oauth2: {
      initTokenClient(config: {
        client_id: string;
        scope: string;
        include_granted_scopes: false;
        callback: (response: unknown) => void;
        error_callback: (error: { type: string }) => void;
      }): { requestAccessToken(config: { prompt: string }): void };
    };
  };
}

declare global {
  interface Window { google?: GoogleIdentity }
}

export async function loadGoogleIdentity(): Promise<void> {
  if (window.google?.accounts.oauth2) return;
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    const timeout = window.setTimeout(() => {
      script.remove();
      reject(new Error('Google-inloggningen tog för lång tid att ladda. Ladda om sidan för att försöka igen.'));
    }, 15_000);
    script.onload = () => { clearTimeout(timeout); resolve(); };
    script.onerror = () => {
      clearTimeout(timeout);
      script.remove();
      reject(new Error('Kunde inte ladda Google-inloggningen. Kontrollera nätverk och innehållsblockerare. Lokal förhandsgranskning fungerar ändå.'));
    };
    document.head.append(script);
  });
}

// Call synchronously from the click handler so browsers permit the OAuth popup.
export function connectGoogle(clientId: string): Promise<AccessToken> {
  return new Promise((resolve, reject) => {
    if (!window.google?.accounts.oauth2) {
      reject(new Error('Google-inloggningen är inte redo. Ladda om sidan och försök igen.'));
      return;
    }
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: GOOGLE_SCOPES.join(' '),
      include_granted_scopes: false,
      callback: (response) => {
        try { resolve(readAccessToken(response)); } catch (error) { reject(error); }
      },
      error_callback: (error) => {
        const messages: Record<string, string> = {
          popup_closed: 'Google-fönstret stängdes. Ingen ny anslutning gjordes.',
          popup_failed_to_open: 'Webbläsaren blockerade Google-fönstret. Tillåt popup-fönster och anslut igen.'
        };
        reject(new Error(messages[error.type] ?? 'Google-inloggningen misslyckades. Försök ansluta igen.'));
      }
    });
    client.requestAccessToken({ prompt: 'select_account' });
  });
}
