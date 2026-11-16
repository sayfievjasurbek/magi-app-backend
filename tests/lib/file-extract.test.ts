import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { decodeFileData, extractFile } from '../../lib/file-extract.js';
import { HttpError } from '../../lib/errors.js';

// hand built docx with the name in a header, like most resume templates
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

const pptxSlideXml = (text: string): string => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
<p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>
</p:sld>`;

const pptxWithSlides = async (slides: string[]): Promise<Buffer> => {
  const zip = new JSZip();
  slides.forEach((text, i) => zip.file(`ppt/slides/slide${i + 1}.xml`, pptxSlideXml(text)));
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
    // fixture from mammoth's own tests
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

  it('reads a .pptx slide by slide, in numeric order (slide10 after slide2, not before)', async () => {
    const buf = await pptxWithSlides(['Welcome to the course', 'Topic: Databases']);
    // slide10 sorts before slide2 alphabetically
    const zip = await JSZip.loadAsync(buf);
    zip.file('ppt/slides/slide10.xml', pptxSlideXml('Thank you'));
    const withTenthSlide = await zip.generateAsync({ type: 'nodebuffer' });

    const result = await extractFile('deck.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', withTenthSlide);

    expect(result.kind).toBe('text');
    const text = (result as { text: string }).text;
    expect(text.indexOf('Welcome to the course')).toBeLessThan(text.indexOf('Topic: Databases'));
    expect(text.indexOf('Topic: Databases')).toBeLessThan(text.indexOf('Thank you'));
  });

  it('rejects a .pptx with no slides', async () => {
    const buf = await pptxWithSlides([]);
    const error = await rejected(extractFile('empty.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', buf));
    expect(error.status).toBe(400);
  });

  it('strips RTF control words and destination groups, keeping the plain text', async () => {
    const rtf = String.raw`{\rtf1\ansi\deff0 {\fonttbl{\f0 Times New Roman;}}
{\colortbl;\red0\green0\blue0;}
John Smith\par
Senior Backend Engineer\par
Skills: Node.js, Postgres\par
}`;

    const result = await extractFile('resume.rtf', 'application/rtf', Buffer.from(rtf, 'latin1'));

    expect(result.kind).toBe('text');
    const text = (result as { text: string }).text;
    expect(text).toContain('John Smith');
    expect(text).toContain('Senior Backend Engineer');
    expect(text).toContain('Skills: Node.js, Postgres');
    expect(text).not.toContain('Times New Roman');
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
    // no text stream, like a scanned pdf
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
