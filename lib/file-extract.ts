// Turns a file a professor attached to a Magi AI chat message into something the model can read:
// plain text for documents (spreadsheets, Word, PDF, plain text), or a real vision input for an
// image - no OCR needed there, the model reads it directly the same way deepReviewAnswers already
// hands it proctoring photos (see lib/ai.ts).
import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { HttpError } from './errors.js';

// base64 inflates by ~4/3 and server.ts caps the JSON body at 10mb - same ballpark as
// SUBMISSION_MAX_BYTES in lib/storage.ts, comfortably under that with room for the rest of the
// chat request (message, history) alongside it. Exported: lib/google-docs.ts applies the same
// cap to an exported Google file, which never passes through decodeFileData itself.
export const MAX_BYTES = 6 * 1024 * 1024;
// a cap on what actually reaches the model - an oversized document would otherwise balloon the
// token count (and cost) of every following message in the same conversation, since it stays in history
const MAX_EXTRACTED_CHARS = 30_000;

/** Strips a `data:<mime>;base64,...` prefix if present and returns the raw bytes + mime type. */
export const decodeFileData = (value: unknown): { bytes: Buffer; mime: string } => {
  if (typeof value !== 'string' || !value) throw new HttpError(400, 'file.data is required');

  const match = value.match(/^data:([^;]+);base64,([\s\S]*)$/);
  const mime = match?.[1] ?? 'application/octet-stream';

  let bytes: Buffer;
  try {
    bytes = Buffer.from(match ? match[2] : value, 'base64');
  } catch {
    throw new HttpError(400, 'file.data must be valid base64');
  }
  if (!bytes.length) throw new HttpError(400, 'file.data is required');
  if (bytes.length > MAX_BYTES) throw new HttpError(400, 'file must be at most 6MB');

  return { bytes, mime };
};

export type ExtractedFile = { kind: 'text'; text: string } | { kind: 'image'; dataUrl: string };

const truncate = (text: string): string =>
  text.length > MAX_EXTRACTED_CHARS ? `${text.slice(0, MAX_EXTRACTED_CHARS)}\n[...truncated, the file continues]` : text;

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const SPREADSHEET_EXTENSIONS = ['.xlsx', '.xls', '.csv'];
const SPREADSHEET_MIMES = [XLSX_MIME, 'application/vnd.ms-excel' /* .xls */, 'text/csv'];
const RTF_MIMES = ['application/rtf', 'text/rtf'];

const decodeXmlEntities = (text: string): string =>
  text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

// shared by the docx header/footer reader below and the pptx slide reader further down - an
// OOXML text run is always <tag ...>text</tag>, grouped into paragraphs by a part-specific tag
// (<w:p> for Word, <a:p> for a PowerPoint slide's DrawingML)
const extractRuns = (xml: string, runTag: string, paragraphTag: string): string =>
  xml
    .split(new RegExp(`</${paragraphTag}>`))
    .map((paragraph) => [...paragraph.matchAll(new RegExp(`<${runTag}[^>]*>([\\s\\S]*?)</${runTag}>`, 'g'))].map((m) => m[1]).join(''))
    .map(decodeXmlEntities)
    .filter((line) => line.trim())
    .join('\n');

// mammoth.extractRawText only reads word/document.xml (the body) - it never looks at
// word/header*.xml or word/footer*.xml, so a name/title living in a header (common in resume
// templates, where the body starts straight into "Experience") was silently dropped entirely.
// A .docx is a zip, and a header/footer part's own XML is simple enough that reading its <w:t>
// runs directly is enough - no need for mammoth's own (header-blind) parser here.
const extractHeadersAndFooters = async (bytes: Buffer): Promise<string> => {
  try {
    const zip = await JSZip.loadAsync(bytes);
    const parts = Object.keys(zip.files).filter((name) => /^word\/(header|footer)\d*\.xml$/.test(name)).sort();
    const texts: string[] = [];
    for (const part of parts) {
      const text = extractRuns(await zip.files[part].async('text'), 'w:t', 'w:p');
      if (text) texts.push(text);
    };
    return texts.join('\n');
  } catch {
    return ''; // not a real zip, or no header/footer parts - the body text is still worth returning
  };
};

// a .pptx is also a zip; each slide is its own ppt/slides/slideN.xml. There is no library already
// pulled in for this (unlike mammoth for .docx), but a slide's own XML is exactly as simple to
// read directly as a docx header's - same approach, DrawingML's <a:t>/<a:p> instead of <w:t>/<w:p>
const extractSlides = async (bytes: Buffer): Promise<string> => {
  const zip = await JSZip.loadAsync(bytes);
  const slideNumber = (path: string) => Number(path.match(/slide(\d+)\.xml$/)?.[1] ?? 0);
  const slidePaths = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => slideNumber(a) - slideNumber(b));
  if (!slidePaths.length) throw new HttpError(400, 'This presentation has no slides to read');

  const slides = await Promise.all(slidePaths.map(async (path, i) => {
    const text = extractRuns(await zip.files[path].async('text'), 'a:t', 'a:p');
    return text ? `Slide ${i + 1}:\n${text}` : null;
  }));
  return slides.filter((slide): slide is string => slide !== null).join('\n\n');
};

// RTF has no library here either, but it's a plain-text format at heart: a destination group
// ({\fonttbl ...}, {\colortbl ...}, ...) carries no body text and is dropped whole, a handful of
// control words turn into whitespace, and a \'hh or \uN escape turns into the character it
// names - everything else between the braces is the text itself
const RTF_DESTINATION_GROUPS = /\{\\(?:fonttbl|colortbl|stylesheet|info|pict|object|header[lrf]?|footer[lrf]?|footnote|generator|\*)(?:[^{}]|\{[^{}]*\})*\}/g;
const rtfToText = (raw: string): string =>
  raw
    .replace(RTF_DESTINATION_GROUPS, '')
    .replace(/\\'([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\u(-?\d+)\s?\??/g, (_, code) => String.fromCharCode(((Number(code) % 65536) + 65536) % 65536))
    .replace(/\\par[d]?\b ?/g, '\n')
    .replace(/\\line\b ?/g, '\n')
    .replace(/\\tab\b ?/g, '\t')
    .replace(/\\[a-zA-Z]+-?\d*[ ]?/g, '')
    .replace(/[{}]/g, '')
    .replace(/\\([\\{}])/g, '$1')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');

export const extractFile = async (name: string, mime: string, bytes: Buffer): Promise<ExtractedFile> => {
  const lowerName = name.toLowerCase();

  if (mime.startsWith('image/')) {
    return { kind: 'image', dataUrl: `data:${mime};base64,${bytes.toString('base64')}` };
  };

  if (mime === 'application/pdf' || lowerName.endsWith('.pdf')) {
    const parser = new PDFParse({ data: bytes });
    try {
      const result = await parser.getText();
      // a scanned/image-only PDF (common for a certificate, a printed form someone photographed
      // into one) has no embedded text to extract - render its first page as an image instead and
      // let the model actually look at it, rather than handing it empty text and a confused reply
      if (result.text.trim().length < 20) {
        const screenshot = await parser.getScreenshot({ first: 1 });
        const page = screenshot.pages[0];
        if (page) return { kind: 'image', dataUrl: page.dataUrl };
      };
      return { kind: 'text', text: truncate(result.text) };
    } finally {
      await parser.destroy();
    };
  };

  if (mime === DOCX_MIME || lowerName.endsWith('.docx')) {
    const [{ value }, headerFooterText] = await Promise.all([
      mammoth.extractRawText({ buffer: bytes }),
      extractHeadersAndFooters(bytes),
    ]);
    const text = headerFooterText ? `${headerFooterText}\n\n${value}` : value;
    return { kind: 'text', text: truncate(text) };
  };

  if (SPREADSHEET_MIMES.includes(mime) || SPREADSHEET_EXTENSIONS.some((ext) => lowerName.endsWith(ext))) {
    const workbook = XLSX.read(bytes, { type: 'buffer' });
    const sheets = workbook.SheetNames.map((sheetName) => {
      const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName]);
      return workbook.SheetNames.length > 1 ? `## ${sheetName}\n${csv}` : csv;
    });
    return { kind: 'text', text: truncate(sheets.join('\n\n')) };
  };

  if (mime === PPTX_MIME || lowerName.endsWith('.pptx')) {
    return { kind: 'text', text: truncate(await extractSlides(bytes)) };
  };

  if (RTF_MIMES.includes(mime) || lowerName.endsWith('.rtf')) {
    return { kind: 'text', text: truncate(rtfToText(bytes.toString('latin1'))) };
  };

  if (mime === 'text/plain' || lowerName.endsWith('.txt')) {
    return { kind: 'text', text: truncate(bytes.toString('utf-8')) };
  };

  throw new HttpError(400, `Unsupported file type: ${mime || lowerName}`);
};
