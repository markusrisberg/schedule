# Schedule to calendar

Preview an exported schedule and import selected shifts into Google Calendar. The web app is a static site built with Vite, TypeScript, and CSS. It needs no backend, database, or separate user account system. The CLI remains available for local conversion to calendar CSV.

## Getting started

Use Node 22.12 or later within Node 22, and pnpm 10. The `packageManager` field pins pnpm 10.34.6.

```bash
corepack enable
pnpm install
pnpm dev
```

Open the URL printed by Vite, usually `http://localhost:5173`. Local CSV preview works without Google configuration. To enable importing, copy `.env.example` to `.env.local`, enter your public OAuth client ID, and restart Vite. Never enter a client secret.

The web app accepts the original semicolon-separated CSV export in UTF-8, up to 1 MB, with the columns `Vecka`, `Datum`, `Dag`, `Från`, `Till`, `Kod`, `Rast`, `Tid`, `Arbetsplats`, and `Anteckningar`. It supports metadata before the table and the export's `Saldoinformation` section after it. Invalid schedule rows reject the entire preview, not just the rest of the file. The web app does not accept HTML or generated calendar CSV as input.

The Swedish UI has four steps: **Läs in CSV → Granska → Välj kalender → Importera**, meaning Load CSV, Review, Choose calendar, and Import. Select a schedule file in the first step. Once the file is read successfully, Granska opens automatically with work and on-call shift counts and an agenda for the first week. All events in the file are initially selected. Click a shift to deselect it. The selection count applies to the entire file, including weeks that are not visible. Continue with Nästa or the next available step in the step navigation. Step navigation, Tillbaka, and week paging preserve the selection and current week. If you return to the file picker, you can reopen Granska through the step navigation without selecting the file again.

The agenda shows Monday through Sunday with dates, shifts, and times. Week arrows navigate from the first to the last week containing events. An overnight shift also appears as a marked continuation on the next day if it ends after midnight. Both cards select the same event, which is imported once. An event ending exactly at midnight does not create a card on the next day. The +1 marker indicates an end time on the following day. Days without generated events are labeled Inga inlästa pass, meaning no loaded shifts, rather than Ledig, meaning a day off. Moving to the calendar step requires at least one selected event. Moving to import requires an active Google connection and a selected calendar you own. A valid file without matching work shifts also opens in Granska but cannot be imported. Successfully loading a new file resets the agenda to the first week and selects all events.

## Design

The web app uses Design A, Lugn. The earlier design alternatives are archived on the local branch `chore/schedule-design-prototypes`.

Agenda is now the actual review view. The three earlier calendar alternatives, Månad, Vecka med tidsaxel, and Agenda, are available as runnable prototypes on the local archive branch `chore/schedule-calendar-prototypes`, commit `1696d8e53a15c9d2787151ba45d97a3d3137d57e`. This archive is separate from the earlier full-page designs and has not been pushed. The prototype command, sample data, and variant switcher are no longer included in the app.

## CLI

```bash
pnpm run parse schedule.csv
```

This command creates `schedule.ical.csv` next to the input file, overwriting any existing output file. Despite its name, `.ical.csv` is a Google Calendar-compatible CSV, **not an .ics file**. The CLI does not use Google or the network. Both the CLI and web app require an original CSV schedule export. HTML input is no longer supported.

## Rules and times

The web app and CLI share the same CSV parser and rules for TJG, MR, and Swedish public holidays from `date-holidays`. Exact codes `TJG` and `.TJG` use the ordinary work rules and titles Jobb dag, Jobb kväll, and Beredskap. Surrounding whitespace in exported cells is trimmed. Other nonempty codes with valid start and end times are included as Jobb (code), for example Jobb (UTB). These special entries bypass holiday exclusions and never generate Beredskap. The agenda shows Jobb dag in green, Jobb kväll in blue, Beredskap in yellow, and special entries in orange. Rows without times or a code do not generate events, but missing times on ordinary work rows and incomplete intervals remain errors. The location is PÄS, and the description is Vecka followed by the week number. Review shows only generated events, not filtered-out schedule rows. You can select events but cannot edit them.

All times are interpreted as Swedish local time, `Europe/Stockholm`, regardless of the device's time zone. Dates and times are validated. Nonexistent or repeated local times at daylight saving transitions are rejected because the export does not specify a UTC offset. A work shift with an end time earlier than its start time ends on the following date. Equal start and end times are rejected. On-call duty ends at midnight after the shift's original date: 2026-08-28 23:00 to 2026-08-29 00:00. This corrects the old output, which incorrectly ended at noon on the same date. An overnight shift that already reaches or passes that midnight does not receive an additional on-call event with zero or negative duration.

`pnpm dev` and `pnpm build:web` run the package's documented `holidays2json --pick SE --min` command. It reduces the installed holiday data and rules to Sweden without introducing custom holiday rules. The command modifies package files in `node_modules`, not source code or schedules. The dependency's time zone data remains in the web bundle. CI runs tests both before and after the reduction. The web build includes dependency licenses in `licenses.md`, including `date-holidays` and its holiday data under CC BY-SA 3.0.

## Google Cloud and OAuth

1. Create or select a Google Cloud project and enable **Google Calendar API**.
2. Configure the OAuth consent screen in Google Auth Platform: app name, support contact, audience, test users, and requested scopes. Public use also requires the applicable publishing, domain, and privacy policy information.
3. Create an OAuth 2.0 client ID of type **Web application**.
4. Add exact **Authorized JavaScript origins**, for example `http://localhost:5173` and `https://YOUR-NAME.github.io`. An origin includes the scheme, host, and optional port, **not** `/REPO/`, a path, or a trailing slash. Add any custom domain separately. The app uses a Google Identity Services token popup, not a backend with a redirect URI and client secret.
5. Set the client ID as `VITE_GOOGLE_CLIENT_ID` in `.env.local` for local development or as a repository variable in GitHub Actions. It is public and embedded in the JavaScript bundle. Rebuild after changes.

Requested scopes:

- `https://www.googleapis.com/auth/calendar.calendarlist.readonly`
- `https://www.googleapis.com/auth/calendar.events.owned`

The owned-events permission is broader than event creation. It also allows reading, editing, and deleting events in owned calendars. The app only uses the calendar list and `events.insert`. It never searches for existing events or modifies or deletes them.

External OAuth in Testing is restricted to named test users and Google's testing limits. Selecting In production does not automatically make the app available to everyone. Sensitive scopes may require Google verification, and untested or unverified apps may face warnings and user limits. Workspace administrators can also block access. Check [Google's OAuth policy and production requirements](https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance) before public release.

Connection starts only when the user clicks. Popup and consent errors are shown in Swedish. A short-lived token is held only in memory, without automatic renewal. The calendar list is paginated and filtered to `owner`. The primary owned calendar's ID identifies the account without additional identity scopes. Import is blocked if the account cannot be identified safely. A saved calendar preference is reused only if it exists in the newly connected account's calendar list.

## Import, privacy, and errors

- Consider creating a separate work calendar in Google Calendar first. The app does not create calendars.
- Select events and an existing calendar, check the destination and event count, and explicitly click the import button.
- The file is read locally and never uploaded. Only selected events are sent directly to Google during import. The page loads Google's sign-in script if a client ID is configured.
- Only the calendar preference per account is saved in `localStorage`. No files, events, tokens, or import results are persisted. There is no analytics collection or logging of schedule data. Clear site data to forget calendar preferences. Koppla från discards the token locally. Revoke the app's permission in your Google account to withdraw consent.
- Events are sent one at a time. The first error stops the import. Results are shown per event: created, failed, uncertain outcome, or not attempted. Transport errors, timeouts, server errors, and unreadable confirmations may mean Google has already created the event. Check the calendar manually.
- Results and errors remain visible in the import step after a partial import. Navigation and changes are locked while reading a file, connecting to Google, or importing. Once import starts, the selection and calendar remain locked even if you go back. If the Google connection expires before import, the app returns to the calendar step. After import starts, results are retained.
- If a replacement file is invalid after an import, the previous results are retained. A new import flow begins only after a new file is read successfully.
- There is no deduplication, queue, automatic retry, or resume feature. The same complete or partial import cannot be submitted again on the page. You can explicitly load the file again, but this may create duplicates.
- The browser normally warns if you leave the page during import. Closing a mobile browser or a crash cannot always be detected. Closing the page loses local results, not events already written to Google.

## Build and verify

```bash
pnpm test
pnpm typecheck
pnpm build       # CLI output to dist/
pnpm build:web   # Web-only output to web-dist/
pnpm preview     # Preview the built site locally
```

Tests use `node:test` and `tsx`, with local fixtures and mocked Google responses, without network access. They do not replace testing real OAuth configuration and consent. For manual CLI verification, copy fixtures to a temporary directory to avoid overwriting your generated files.

The `test/fixtures/202603.csv` fixture keeps its original filename but contains entirely invented March 2030 data, including test-only metadata, workplaces, and balances. Preserve the original export formatting when editing it: UTF-8 BOM, quoted fields, spaces inside quotes, quoted empty records, trailing empty fields, and CRLF line endings except for the final LF-terminated empty record. The full layout includes metadata, carried week numbers, and `Saldoinformation`. Its hand-authored `.ical.csv` expectation covers day, evening, and overnight shifts, a special UTB entry, excluded untimed rows, MR suppression, and Friday/Sunday on-call duty. Neither file represents a person's schedule.

## GitHub Pages

The repository had no remote when the app was implemented. Create or connect a GitHub repository and publish the code manually after review. Check that no personal schedule exports are included. Test fixtures live in the source repository but must never be included in the deployed site.

1. Select **Settings → Pages → Build and deployment → GitHub Actions**.
2. Add the repository variable `VITE_GOOGLE_CLIENT_ID` under **Settings → Secrets and variables → Actions → Variables**.
3. The `.github/workflows/pages.yml` workflow tests and builds on pull requests and on `main`. Only `main` can deploy, including manual runs. Adjust the branch conditions if your default branch has another name.
4. The default base path is `/<REPO>/`. For `https://<NAME>.github.io/` or a custom domain, set the repository variable `VITE_BASE_PATH` to `/` and configure any custom domain in the Pages settings. Remember to add its OAuth origin. To test a repository base path locally, run `VITE_BASE_PATH=/schedule/ pnpm build:web`.

The workflow installs Node 22 and pnpm 10, then runs tests, typechecking, the CLI build, and the web build. **Only `web-dist/` is uploaded to Pages**. Vite's root is `web/`, with no public directory copied into the build. `dist/`, raw CSV/HTML exports, reference files, and test fixtures are not included in the deployed site.
