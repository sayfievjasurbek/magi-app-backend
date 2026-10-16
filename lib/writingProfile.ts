// Turns the raw per-question typing counters (attempt.service.ts's ANSWER_COLUMNS) into the
// summary a professor actually wants to glance at on an attempt: how much of the answer was
// typed vs pasted, how natural the typing rhythm looked, and how much the student revised as
// they went - the same shape of signal a "human authorship" writing certificate shows, but
// computed from this app's own data instead of taken on faith from a third-party badge.

export type WritingCounters = {
  text_typed: number;
  text_edited: number;
  text_pasted: number;
  paste_events: number;
  text_deleted: number;
  freeze_count: number;
  longest_freeze: number;
  typing_duration_seconds: number;
};

export type WritingProfile = {
  characters_typed: number;
  characters_pasted: number;
  paste_events: number;
  corrections: number;
  freeze_count: number;
  longest_freeze: number;
  // 0-100, or null when there's nothing to score yet (nothing typed or pasted)
  volume_score: number | null;
  rhythm_score: number | null;
  edit_score: number | null;
  process_strength: number | null;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

// Characters typed by hand vs pasted in - a wall of pasted text with almost no typing is the
// single strongest "this wasn't written here" signal.
const volumeScore = (typed: number, pasted: number): number | null =>
  typed + pasted > 0 ? Math.round((typed / (typed + pasted)) * 100) : null;

// Long silent gaps followed by a sudden run of text reads as switching away to write (or copy)
// the answer elsewhere; each freeze costs points, a long one costs more.
const rhythmScore = (freezeCount: number, longestFreeze: number, typingSeconds: number): number | null => {
  if (typingSeconds <= 0 && freezeCount === 0) return null;
  const longestPenalty = typingSeconds > 0 ? Math.min(40, (longestFreeze / typingSeconds) * 100) : Math.min(40, longestFreeze);
  return Math.round(clamp(100 - freezeCount * 8 - longestPenalty, 0, 100));
};

// Real writing gets revised - backspaces, rewordings, mid-sentence fixes. A long answer with
// close to zero corrections is as suspicious as one with constant chaotic rewriting is normal;
// this rewards corrections up to a natural ceiling rather than penalizing them.
const editScore = (corrections: number, typed: number): number | null =>
  typed > 0 ? Math.round(clamp((corrections / typed) * 500, 0, 100)) : null;

// A single overall number, but scaled down for short sessions: a handful of characters can look
// "perfect" by accident, so confidence in the other three scores only reaches 1.0 once there's
// a real amount of typed text to judge them from (this is the same reason the certificate
// labels a thin session "Developing" instead of trusting a high sub-score outright).
const CONFIDENT_AT_CHARACTERS = 400;
const processStrength = (scores: Array<number | null>, charactersTyped: number): number | null => {
  const present = scores.filter((s): s is number => s !== null);
  if (!present.length) return null;
  const average = present.reduce((sum, s) => sum + s, 0) / present.length;
  const confidence = clamp(charactersTyped / CONFIDENT_AT_CHARACTERS, 0, 1);
  return Math.round(average * confidence);
};

export const computeWritingProfile = (questions: WritingCounters[]): WritingProfile => {
  const typed = questions.reduce((sum, q) => sum + q.text_typed, 0);
  const pasted = questions.reduce((sum, q) => sum + q.text_pasted, 0);
  const pasteEvents = questions.reduce((sum, q) => sum + q.paste_events, 0);
  const corrections = questions.reduce((sum, q) => sum + q.text_edited, 0);
  const freezeCount = questions.reduce((sum, q) => sum + q.freeze_count, 0);
  const longestFreeze = questions.reduce((max, q) => Math.max(max, q.longest_freeze), 0);
  const typingSeconds = questions.reduce((sum, q) => sum + q.typing_duration_seconds, 0);

  const volume = volumeScore(typed, pasted);
  const rhythm = rhythmScore(freezeCount, longestFreeze, typingSeconds);
  const edit = editScore(corrections, typed);

  return {
    characters_typed: typed,
    characters_pasted: pasted,
    paste_events: pasteEvents,
    corrections,
    freeze_count: freezeCount,
    longest_freeze: longestFreeze,
    volume_score: volume,
    rhythm_score: rhythm,
    edit_score: edit,
    process_strength: processStrength([volume, rhythm, edit], typed),
  };
};

// Turns the AI review's coarse low/medium/high into the same 0-100 scale as the other scores,
// so the UI can show one number instead of three different units. Null (not a 0) when no AI
// review has been run yet - that's "not analyzed", not "0% likely".
export const aiProbabilityOf = (cheatingLikelihood: 'low' | 'medium' | 'high' | null | undefined): number | null => {
  if (!cheatingLikelihood) return null;
  return { low: 15, medium: 50, high: 85 }[cheatingLikelihood];
};
