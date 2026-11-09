import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { decodeFileData, extractFile } from '../../lib/file-extract.js';
import { HttpError } from '../../lib/errors.js';

const rejected = async (promise: Promise<unknown>): Promise<any> => promise.then(() => null, (error) => error);

describe('decodeFileData', () => {
  it('strips a data:<mime>;base64,... prefix and decodes the bytes', () => {
    const { bytes, mime } = decodeFileData('data:text/csv;base64,aGVsbG8=');
    expect(mime).toBe('text/csv');
    expect(bytes.toString('utf-8')).toBe('hello');
  });

  it('defaults to application/octet-stream for bare base64 with no prefix', () => {
    const { mime } = decodeFileData('aGVsbG8=');
    expect(mime).toBe('application/octet-stream');
  });

  it('rejects missing, empty, or oversized data', async () => {
    expect((await rejected(Promise.resolve().then(() => decodeFileData(undefined)))).status).toBe(400);
    expect((await rejected(Promise.resolve().then(() => decodeFileData('data:text/plain;base64,')))).status).toBe(400);

    const oversized = `data:text/plain;base64,${Buffer.alloc(7 * 1024 * 1024, 'a').toString('base64')}`;
    const error = await rejected(Promise.resolve().then(() => decodeFileData(oversized)));
    expect(error).toBeInstanceOf(HttpError);
    expect(error.status).toBe(400);
  });
});

describe('extractFile', () => {
  it('reads a CSV as plain text', async () => {
    const result = await extractFile('questions.csv', 'text/csv', Buffer.from('title,question\nQ1,What is 2+2?\n'));
    expect(result).toEqual({ kind: 'text', text: 'title,question\nQ1,What is 2+2?' });
  });

  it('reads an xlsx workbook, rendering each sheet to CSV-ish text', async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['title', 'question'], ['Q1', 'What is 2+2?']]), 'Sheet1');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

    const result = await extractFile('questions.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buf);

    expect(result.kind).toBe('text');
    expect((result as { text: string }).text).toContain('What is 2+2?');
  });

  it('reads a .docx by its extension even without the exact mime type', async () => {
    // a real, mammoth-authored fixture (its own test suite relies on this exact file) - only
    // asserting the extraction pipeline actually runs and returns text, not mammoth's own output
    const buf = readFileSync(new URL('../../node_modules/mammoth/test/test-data/utf8-bom.docx', import.meta.url));

    const result = await extractFile('notes.docx', 'application/octet-stream', buf);

    expect(result.kind).toBe('text');
    expect((result as { text: string }).text.length).toBeGreaterThan(0);
  });

  it('extracts text from a PDF', async () => {
    // a minimal, hand-written single-page PDF with one line of text - self-contained, no fixture file
    const pdf = [
      '%PDF-1.1',
      '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
      '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
      '3 0 obj << /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 300 144] /Contents 5 0 R >> endobj',
      '4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj',
      '5 0 obj << /Length 58 >>',
      'stream',
      'BT /F1 18 Tf 10 100 Td (Hello Magi PDF) Tj ET',
      'endstream',
      'endobj',
      'trailer << /Size 6 /Root 1 0 R >>',
      '%%EOF',
    ].join('\n');

    const result = await extractFile('notes.pdf', 'application/pdf', Buffer.from(pdf, 'latin1'));

    expect(result.kind).toBe('text');
    expect((result as { text: string }).text).toContain('Hello Magi PDF');
  });

  it('hands an image back as a data url instead of extracting text', async () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

    const result = await extractFile('photo.png', 'image/png', png);

    expect(result).toEqual({ kind: 'image', dataUrl: `data:image/png;base64,${png.toString('base64')}` });
  });

  it('rejects an unsupported file type', async () => {
    const error = await rejected(extractFile('archive.zip', 'application/zip', Buffer.from('PK')));
    expect(error).toBeInstanceOf(HttpError);
    expect(error.status).toBe(400);
  });
});
