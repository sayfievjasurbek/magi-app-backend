import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { decodeFileData, extractFile } from '../../lib/file-extract.js';
import { HttpError } from '../../lib/errors.js';

// a minimal but real docx, built by hand rather than taken from a fixture, specifically to put
// text in a header - this is exactly the shape of a resume template, where the candidate's name
// sits in a header while the body starts straight into "Experience: ..."
const docxWithHeader = async (headerLines: string[], bodyText: string): Promise<Buffer> => {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
</Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body><w:p><w:r><w:t>${bodyText}</w:t></w:r></w:p></w:body>
</w:document>`);
  zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>
</Relationships>`);
  zip.file('word/header1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
${headerLines.map((line) => `<w:p><w:r><w:t>${line}</w:t></w:r></w:p>`).join('\n')}
</w:hdr>`);
  return zip.generateAsync({ type: 'nodebuffer' });
};

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

  it('reads the name out of a resume whose header mammoth itself never looks at', async () => {
    const buf = await docxWithHeader(['John Smith', 'Senior Backend Engineer'], 'Experience: 5 years in software engineering.');

    const result = await extractFile('resume.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buf);

    expect(result.kind).toBe('text');
    expect((result as { text: string }).text).toContain('John Smith');
    expect((result as { text: string }).text).toContain('Experience: 5 years in software engineering.');
  });

  it('extracts text from a PDF that has real embedded text', async () => {
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

  it('renders a scanned/image-only PDF (no embedded text) as an image instead', async () => {
    // same minimal single-page PDF, but with no text stream at all - the common shape of a
    // scanned certificate or a photographed form
    const pdf = [
      '%PDF-1.1',
      '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
      '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
      '3 0 obj << /Type /Page /Parent 2 0 R /Resources << >> /MediaBox [0 0 300 144] /Contents 5 0 R >> endobj',
      '5 0 obj << /Length 0 >>',
      'stream',
      'endstream',
      'endobj',
      'trailer << /Size 6 /Root 1 0 R >>',
      '%%EOF',
    ].join('\n');

    const result = await extractFile('certificate.pdf', 'application/pdf', Buffer.from(pdf, 'latin1'));

    expect(result.kind).toBe('image');
    expect((result as { dataUrl: string }).dataUrl).toMatch(/^data:image\/png;base64,/);
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
