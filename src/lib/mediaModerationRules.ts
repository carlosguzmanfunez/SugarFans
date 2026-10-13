// What the automatic scan decides for a photo or a video (api/moderate.ts).
// Sightengine's nudity-2.1 model gives 0-1 scores per level, from most explicit
// (sexual_activity) to least (mildly_suggestive). Fans Reserve isn't an adult
// site: explicit content is blocked, doubtful content goes to an admin, the rest
// (swimwear at the beach, a normal outfit) is published.
//
// Kept separate so it can be tested and so another service (PhotoDNA, once the
// company exists) can add its own verdict next to this one.

export type MediaVerdict = 'approved' | 'review' | 'rejected';

export interface NudityScores {
  sexual_activity?: number;
  sexual_display?: number;
  erotica?: number;
  very_suggestive?: number;
  suggestive?: number;
  suggestive_classes?: { sextoy?: number; visibly_undressed?: number; [k: string]: unknown };
  [k: string]: unknown;
}

export interface MediaJudgement {
  verdict: MediaVerdict;
  reason: string;
}

// Blocked without asking anyone (an admin can still reverse it).
export const BLOCK_AT = 0.85;
// Sent to an admin.
export const REVIEW_AT = 0.5;
export const VERY_SUGGESTIVE_REVIEW_AT = 0.85;

const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export const judgeNudity = (s: NudityScores | null | undefined): MediaJudgement => {
  if (!s) return { verdict: 'review', reason: 'El servicio no devolvió resultados' };
  const explicit = Math.max(n(s.sexual_activity), n(s.sexual_display), n(s.erotica));
  if (explicit >= BLOCK_AT) return { verdict: 'rejected', reason: 'Desnudez o contenido sexual explícito' };
  if (explicit >= REVIEW_AT) return { verdict: 'review', reason: 'Posible desnudez' };
  if (n(s.suggestive_classes?.sextoy) >= VERY_SUGGESTIVE_REVIEW_AT) return { verdict: 'review', reason: 'Posible juguete sexual' };
  if (n(s.very_suggestive) >= VERY_SUGGESTIVE_REVIEW_AT || n(s.suggestive_classes?.visibly_undressed) >= VERY_SUGGESTIVE_REVIEW_AT)
    return { verdict: 'review', reason: 'Contenido muy sugerente' };
  return { verdict: 'approved', reason: '' };
};

const rank: Record<MediaVerdict, number> = { approved: 0, review: 1, rejected: 2 };

// A video is as bad as its worst frame.
export const judgeFrames = (frames: { nudity?: NudityScores }[] | null | undefined): MediaJudgement => {
  if (!frames?.length) return { verdict: 'review', reason: 'El servicio no analizó ningún fotograma' };
  return frames
    .map((f) => judgeNudity(f.nudity))
    .reduce((worst, j) => (rank[j.verdict] > rank[worst.verdict] ? j : worst), { verdict: 'approved', reason: '' } as MediaJudgement);
};
