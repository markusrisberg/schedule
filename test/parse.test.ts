import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import test, { describe, it } from 'node:test';

import { getOutputPath, parseFileToCsv, writeCsvForFile } from '../src/parse';

const fixturesDir = path.join(__dirname, 'fixtures');

describe('given a legacy HTML export', () => {
  describe('when converting the file for calendar import', () => {
    it('should reject HTML without changing the input or creating output', (t) => {
      const directory = fs.mkdtempSync(path.join(tmpdir(), 'schedule-html-rejection-'));
      t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
      const inputPath = path.join(directory, 'schedule.html');
      const html = `<html><body><table>
        <tr><td colspan="9">Synthetic schedule</td></tr>
        <tr><td>Vecka</td><td>Datum</td><td>Dag</td><td>Start</td><td>End</td><td>Kod</td><td>Rast</td><td>Tid</td><td>Anteckningar</td></tr>
        <tr><td>40</td><td>2026-10-01</td><td>Thu</td><td>08:00</td><td>16:00</td><td>TJG</td><td></td><td>08:00</td><td></td></tr>
      </table></body></html>`;
      fs.writeFileSync(inputPath, html);

      assert.throws(() => writeCsvForFile(inputPath), /Unsupported input format.*CSV/i);
      assert.equal(fs.readFileSync(inputPath, 'utf8'), html);
      assert.deepEqual(fs.readdirSync(directory), ['schedule.html']);
    });
  });
});

describe('given a synthetic full CSV export', () => {
  describe('when converting the file for calendar import', () => {
    it('should match the hand-authored work and on-call events', () => {
      const inputPath = path.join(fixturesDir, '202603.csv');
      const outputPath = path.join(fixturesDir, '202603.ical.csv');
      const actual = parseFileToCsv(inputPath);
      const expected = fs.readFileSync(outputPath, 'utf8');

      assert.strictEqual(actual, expected);
    });
  });
});

describe('given an input path', () => {
  test('should write csv outputs with an ical csv suffix', () => {
    assert.strictEqual(getOutputPath('202603.csv'), '202603.ical.csv');
  });
});
