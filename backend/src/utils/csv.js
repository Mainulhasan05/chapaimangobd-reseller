'use strict';

const { logger } = require('../config/logger');

/**
 * CSV for people opening the file in Excel or Google Sheets, which is every
 * person who downloads one here.
 */

/*
 * A spreadsheet runs a cell that starts with one of these as a formula. A
 * customer who types `=HYPERLINK(...)` as their name would otherwise get code
 * executed on the owner's machine when the export is opened. A leading
 * apostrophe makes the cell plain text. OWASP "CSV injection".
 */
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * A cell the exporter builds itself and deliberately wants evaluated, such as
 * `="+8801..."` to keep a phone number from being turned into a float. Never
 * wrap anything that came from a user.
 */
const trustedFormula = (text) => ({ trustedFormula: text });

function csvCell(value) {
  if (value == null) return '';
  // A real number is data, and a negative balance must stay a number.
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';

  let text;
  if (typeof value === 'object' && typeof value.trustedFormula === 'string') {
    text = value.trustedFormula;
  } else {
    text = String(value);
    if (FORMULA_START.test(text)) text = `'${text}`;
  }
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const csvRow = (cells) => `${cells.map(csvCell).join(',')}\n`;

/**
 * Streams rather than buffering: a season of orders built in memory would take
 * down a small VPS. The byte-order mark is what stops Excel rendering Bengali
 * as mojibake.
 *
 * Once the first byte is out the status is 200 and an error envelope is no
 * longer possible, so a failure mid-stream destroys the response instead. The
 * download then fails visibly rather than arriving quietly truncated.
 */
async function streamCsv(req, res, { filename, headers, cursor, toRow }) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.write('﻿');
  res.write(csvRow(headers));

  try {
    for await (const doc of cursor) {
      // The owner closed the tab. Stop reading the collection for nobody.
      if (res.destroyed) break;
      const ok = res.write(csvRow(toRow(doc)));
      if (!ok && !res.destroyed) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => {
          res.once('drain', resolve);
          res.once('close', resolve);
        });
      }
    }
    if (!res.destroyed) res.end();
  } catch (err) {
    (req.log || logger).error({ err, filename }, 'csv export failed mid-stream');
    res.destroy();
  } finally {
    if (typeof cursor.close === 'function') await cursor.close().catch(() => {});
  }
}

module.exports = { csvCell, csvRow, streamCsv, trustedFormula };
