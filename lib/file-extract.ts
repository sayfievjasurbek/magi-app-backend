// Turns a file a professor attached to a Magi AI chat message into something the model can read:
// plain text for documents (spreadsheets, Word, PDF, plain text), or a real vision input for an
// image - no OCR needed there, the model reads it directly the same way deepReviewAnswers already
// hands it proctoring photos (see lib/ai.ts).
import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import { HttpError } from './errors.js';

// base64 inflates by ~4/3 and server.ts caps the JSON body at 10mb - same ballpark as
// SUBMISSION_MAX_BYTES in lib/storage.ts, comfortably under that with room for the rest of the
// chat request (message, history) alongside it
const MAX_BYTES = 6 * 1024 * 1024;
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

const SPREADSHEET_EXTENSIONS = ['.xlsx', '.xls', '.csv'];
const SPREADSHEET_MIMES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-excel', // .xls
  'text/csv',
];
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export const extractFile = async (name: string, mime: string, bytes: Buffer): Promise<ExtractedFile> => {
  const lowerName = name.toLowerCase();

  if (mime.startsWith('image/')) {
    return { kind: 'image', dataUrl: `data:${mime};base64,${bytes.toString('base64')}` };
  };

  if (mime === 'application/pdf' || lowerName.endsWith('.pdf')) {
    const parser = new PDFParse({ data: bytes });
    try {
      const result = await parser.getText();
      return { kind: 'text', text: truncate(result.text) };
    } finally {
      await parser.destroy();
    };
  };

  if (mime === DOCX_MIME || lowerName.endsWith('.docx')) {
    const { value } = await mammoth.extractRawText({ buffer: bytes });
    return { kind: 'text', text: truncate(value) };
  };

  if (SPREADSHEET_MIMES.includes(mime) || SPREADSHEET_EXTENSIONS.some((ext) => lowerName.endsWith(ext))) {
    const workbook = XLSX.read(bytes, { type: 'buffer' });
    const sheets = workbook.SheetNames.map((sheetName) => {
      const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName]);
      return workbook.SheetNames.length > 1 ? `## ${sheetName}\n${csv}` : csv;
    });
    return { kind: 'text', text: truncate(sheets.join('\n\n')) };
  };

  if (mime === 'text/plain' || lowerName.endsWith('.txt')) {
    return { kind: 'text', text: truncate(bytes.toString('utf-8')) };
  };

  throw new HttpError(400, `Unsupported file type: ${mime || lowerName}`);
};
