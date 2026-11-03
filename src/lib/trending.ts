// "En tendencia" in Explorar: one list of every creator, ordered by points anyone
// can earn with their own activity. Nobody is left out: active creators go first,
// everyone else follows.
import type { FeaturedCreator } from './backend/rewardTypes';

export interface RecentPosts {
  count: number; // posts in the last 7 days
  last: string; // ISO date of the newest one
}

export interface TrendingInput {
  recent: Record<string, RecentPosts>;
  newFans: Record<string, number>; // new paying fans this month (subs, Reserve, gifts)
  featured: FeaturedCreator[]; // Recompensas: Destacado / En ascenso keep their boost
  categoryOf: (creatorId: string) => string | undefined;
}

export const TRENDING_WINDOW_DAYS = 7;

const FEATURED_POINTS: Record<FeaturedCreator['reason'], number> = { special: 4, level: 3, medal: 2, rising: 1 };
const CATEGORY_PODIUM = [3, 2, 1];

export const trendingScores = (ids: string[], input: TrendingInput): Map<string, number> => {
  const { recent, newFans, featured, categoryOf } = input;
  const featuredPoints = new Map(featured.map((f) => [f.creatorProfileId, FEATURED_POINTS[f.reason] ?? 0]));

  // Place in their category by new fans this month (top 3 score).
  const podium = new Map<string, number>();
  const byCategory = new Map<string, string[]>();
  for (const id of ids) {
    const cat = categoryOf(id);
    if (!cat || !(newFans[id] > 0)) continue;
    byCategory.set(cat, [...(byCategory.get(cat) ?? []), id]);
  }
  for (const list of byCategory.values()) {
    list
      .sort((a, b) => newFans[b] - newFans[a])
      .slice(0, CATEGORY_PODIUM.length)
      .forEach((id, i) => podium.set(id, CATEGORY_PODIUM[i]));
  }

  const scores = new Map<string, number>();
  for (const id of ids) {
    const posts = recent[id]?.count ?? 0;
    const fans = newFans[id] ?? 0;
    const score =
      (posts > 0 ? 3 : 0) + Math.min(posts, 5) * 0.5 + // posted this week (more posts help a little)
      Math.min(fans, 10) + // new fans or sales this month
      (podium.get(id) ?? 0) + // top 3 of their category
      (featuredPoints.get(id) ?? 0); // Recompensas boost
    scores.set(id, score);
  }
  return scores;
};

// Highest score first; ties go to whoever posted most recently, then keep the
// incoming order (so the list never jumps around for no reason).
export const byTrending = <T extends { id: string }>(list: T[], input: TrendingInput): T[] => {
  const scores = trendingScores(list.map((c) => c.id), input);
  const lastOf = (id: string) => input.recent[id]?.last ?? '';
  return list
    .map((c, i) => ({ c, i }))
    .sort((a, b) => (scores.get(b.c.id)! - scores.get(a.c.id)!) || lastOf(b.c.id).localeCompare(lastOf(a.c.id)) || a.i - b.i)
    .map(({ c }) => c);
};
