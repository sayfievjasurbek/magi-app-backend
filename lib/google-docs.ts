// Lets a professor paste a Google Docs/Sheets/Slides link straight into a Magi AI chat message,
// instead of having to download it and attach the file - only works for a document shared as
// "Anyone with the link can view", since there is no Google sign-in here to go through. Reuses
// each format's own export endpoint, then feeds the bytes through the same extractFile() an
// uploaded file of that type would go through.
import { HttpError } from './errors.js';
import { DOCX_MIME, PPTX_MIME, XLSX_MIME, MAX_BYTES } from './file-extract.js';

type GoogleDocKind = 'document' | 'spreadsheets' | 'presentation';

const GOOGLE_DOC_RE = /https:\/\/docs\.google\.com\/(document|spreadsheets|presentation)\/d\/([a-zA-Z0-9_-]+)/;

const EXPORT: Record<GoogleDocKind, { url: (id: string) => string; mime: string; name: string }> = {
  document: { url: (id) => `https://docs.google.com/document/d/${id}/export?format=docx`, mime: DOCX_MIME, name: 'google-doc.docx' },
  spreadsheets: { url: (id) => `https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`, mime: XLSX_MIME, name: 'google-sheet.xlsx' },
  presentation: { url: (id) => `https://docs.google.com/presentation/d/${id}/export/pptx`, mime: PPTX_MIME, name: 'google-slides.pptx' },
};

/** The first Google Docs/Sheets/Slides link found in a chat message, if any. */
export const findGoogleDocLink = (text: string): { kind: GoogleDocKind; id: string } | null => {
  const match = text.match(GOOGLE_DOC_RE);
  if (!match) return null;
  return { kind: match[1] as GoogleDocKind, id: match[2] };
};

/** Downloads a Google Docs/Sheets/Slides link via its export endpoint - 400s with a plain
    explanation if the document isn't link-shared (Google answers with its own HTML sign-in/denied
    page instead of the file, rather than an HTTP error status). */
export const fetchGoogleDoc = async (kind: GoogleDocKind, id: string): Promise<{ name: string; mime: string; bytes: Buffer }> => {
  const spec = EXPORT[kind];
  const response = await fetch(spec.url(id), { redirect: 'follow' });
  const contentType = response.headers.get('content-type') ?? '';
  if (!response.ok || contentType.includes('text/html')) {
    throw new HttpError(400, 'Could not open that Google link - share it as "Anyone with the link can view" and try again.');
  };

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_BYTES) throw new HttpError(400, 'That Google document is too large (over 6MB exported)');

  return { name: spec.name, mime: spec.mime, bytes };
};
