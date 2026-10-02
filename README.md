# TimeCare schedule to calendar

A web app that parses schedule data exported from TimeCare and lets you import selected shifts into Google Calendar. The interface is in Swedish and works on phones and computers.

## How to use it

1. Download your schedule from TimeCare in CSV format.
2. Open the file in the app and review your shifts in the weekly agenda.
3. Select the shifts you want to import.
4. Connect Google, choose a calendar you own, and import.

The app applies work and on-call rules to TJG shifts. Other shift codes are included with their original times and highlighted in orange for review.

Your CSV is read locally in your browser. Only selected events are sent to Google when you import. Importing the same schedule again can create duplicates.

## Run locally

Requires Node.js 22.12+ within Node 22 and pnpm 10.

```bash
pnpm install
pnpm dev
```

Previewing schedules works without Google configuration. To enable Google import, copy `.env.example` to `.env.local`, set `VITE_GOOGLE_CLIENT_ID` to your Google OAuth web client ID, and restart the app. Use the client ID, not the client secret.

## Command line

```bash
pnpm run parse schedule.csv
```

Creates `schedule.ical.csv` for manual import into Google Calendar, overwriting any existing output file. This is a CSV file, not an `.ics` file.
