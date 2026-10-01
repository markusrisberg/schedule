#!/usr/bin/env node

import * as path from 'node:path';

import { writeCsvForFile } from '../src/parse';

if (process.argv.length !== 3) {
  console.error('Specify input CSV schedule file.');
  process.exit(1);
}

try {
  const inputPath = path.resolve(process.argv[2]);
  const outputPath = writeCsvForFile(inputPath);
  console.log(`Wrote ${outputPath}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Kunde inte läsa schemat.');
  process.exitCode = 1;
}
