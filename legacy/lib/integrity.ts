export type IntegrityRisk = 'low' | 'medium' | 'high';

export const RISK_ORDER: Record<IntegrityRisk, number> = { low: 1, medium: 2, high: 3 };

export const pasteRatio = (charactersTyped: number | null, charactersPasted: number | null): number | null => {
  if (charactersTyped === null || charactersPasted === null) return null;
  const total = charactersTyped + charactersPasted;
  return total === 0 ? 0 : charactersPasted / total;
};

export const computeIntegrityRisk = (input: {
  aiProbability: number | null;
  humanTypingScore: number | null;
  pasteRatio: number | null;
}): IntegrityRisk | null => {
  const { aiProbability, humanTypingScore, pasteRatio } = input;
  if (aiProbability === null && humanTypingScore === null && pasteRatio === null) return null;

  if ((aiProbability ?? 0) >= 60 || (humanTypingScore ?? 100) < 40 || (pasteRatio ?? 0) >= 0.5) return 'high';
  if ((aiProbability ?? 0) >= 30 || (humanTypingScore ?? 100) < 70 || (pasteRatio ?? 0) >= 0.2) return 'medium';
  return 'low';
};

export const worstRisk = (risks: (string | null)[]): IntegrityRisk | null => {
  let worst: IntegrityRisk | null = null;
  for (const risk of risks) {
    if (risk && risk in RISK_ORDER && (!worst || RISK_ORDER[risk as IntegrityRisk] > RISK_ORDER[worst])) {
      worst = risk as IntegrityRisk;
    }
  }
  return worst;
};
