import * as fs from 'node:fs';
import { extractRowsFromCsv, type ScheduleRow } from './schedule';
import { rowsToEvents } from './events';
import { eventsToCsv } from './calendar-csv';
export { CSV_HEADER } from './calendar-csv';

export function rowsToCsv(rows: ScheduleRow[]): string {
  return eventsToCsv(rowsToEvents(rows));
}

export function parseFileToCsv(inputPath: string): string {
  if (!/\.csv$/i.test(inputPath)) {
    throw new Error('Unsupported input format. Use a CSV schedule export.');
  }
  return rowsToCsv(extractRowsFromCsv(fs.readFileSync(inputPath, 'utf8')));
}

export function getOutputPath(inputPath: string): string {
  return inputPath.replace(/\.csv$/i, '.ical.csv');
}

export function writeCsvForFile(inputPath: string): string {
  const outputPath = getOutputPath(inputPath);
  const csv = parseFileToCsv(inputPath);
  fs.writeFileSync(outputPath, csv, 'utf8');
  return outputPath;
}
