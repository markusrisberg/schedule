export interface ScheduleRow {
  week: string;
  date: string;
  day: string;
  start: string;
  end: string;
  code: string;
  timebreak: string;
  time: string;
  notes: string;
}

function normalizeCell(text: string): string {
  return text.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeTime(time: string): string {
  return time.replace(/^(\d{2}):(\d{2})$/, '$1$2');
}

function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let closed = false;
  const input = csv.replace(/^\ufeff/, '').replace(/\r\n?/g, '\n');

  for (let i = 0; i <= input.length; i += 1) {
    const character = input[i];
    if (quoted) {
      if (character === undefined) throw new Error('CSV-filen har ett oavslutat citattecken.');
      if (character === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
          closed = true;
        }
      } else field += character;
    } else if (character === ';' || character === '\n' || character === undefined) {
      row.push(normalizeCell(field));
      field = '';
      closed = false;
      if (character !== ';') {
        rows.push(row);
        row = [];
      }
    } else if (character === '"' && !field.trim() && !closed) {
      quoted = true;
      field = '';
    } else {
      if (character === '"' || (closed && character.trim())) {
        throw new Error('CSV-filen har felaktiga citattecken eller avgränsare.');
      }
      field += character;
    }
  }
  return rows;
}

const HEADER = ['Vecka', 'Datum', 'Dag', 'Från', 'Till', 'Kod', 'Rast', 'Tid', 'Arbetsplats', 'Anteckningar'];

export function extractRowsFromCsv(csv: string): ScheduleRow[] {
  const rows = parseCsv(csv);
  const headerIndex = rows.findIndex((row) => HEADER.every((label, index) => row[index] === label));
  if (headerIndex === -1) {
    throw new Error('Hittade ingen schematabell. Välj den ursprungliga CSV-exporten med Vecka, Datum och Anteckningar, inte en kalender-CSV eller HTML-fil.');
  }
  const schedule: ScheduleRow[] = [];
  let currentWeek = '';
  let footer = false;
  for (const [index, row] of rows.entries()) {
    if (index <= headerIndex || row.every((cell) => !cell)) continue;
    if (row[0] === 'Saldoinformation' && row.slice(1).every((cell) => !cell)) {
      footer = true;
      continue;
    }
    if (footer) {
      if (row.length >= 10 || /^\d{4}-/.test(row[1] ?? '')) {
        throw new Error('Oväntad schemarad efter Saldoinformation. Ingen del av filen har importerats.');
      }
      continue;
    }
    if (row.length < 10 || row.slice(10).some(Boolean) || !/^\d{4}-\d{2}-\d{2}$/.test(row[1])) {
      throw new Error(`Felaktig schemarad ${index + 1}. Kontrollera datum och kolumner i originalexporten.`);
    }
    if (row[0]) currentWeek = row[0];
    if (!/^\d{1,2}$/.test(currentWeek) || Number(currentWeek) < 1 || Number(currentWeek) > 53) {
      throw new Error(`Veckonummer saknas eller är ogiltigt på schemarad ${index + 1}.`);
    }
    schedule.push({
      week: currentWeek, date: row[1], day: row[2],
      start: normalizeTime(row[3]), end: normalizeTime(row[4]), code: row[5],
      timebreak: normalizeTime(row[6]), time: normalizeTime(row[7]), notes: row[9]
    });
  }
  if (!schedule.length) throw new Error('CSV-filen innehåller inga schemarader.');
  return schedule;
}
