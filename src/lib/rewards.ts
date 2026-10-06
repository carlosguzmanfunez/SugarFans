// UI access to creator rewards: the creator's dashboard, level badges and the
// featured list. Reloads with the platform, since every payment can change them.
import { backend } from './backend';
import { usePlatformQuery } from './platform';
import type { CreatorBadges, FeaturedCreator, LevelId } from './backend/rewardTypes';

export * from './rewardRules';
export type * from './backend/rewardTypes';

export const rewardsApi = backend.rewards;

// Featured creators first (with their level), then the rest of the list.
export const useFeatured = () =>
  usePlatformQuery(() => rewardsApi.featured(), [], [] as FeaturedCreator[]).data;

export const useLevels = (ids: string[]) =>
  usePlatformQuery(() => rewardsApi.levels(ids), [ids.join(',')], {} as Record<string, LevelId>).data;

// Level plus the Puntual and Constante medals fans see on a profile.
export const useBadges = (ids: string[]) =>
  usePlatformQuery(() => rewardsApi.badges(ids), [ids.join(',')], {} as Record<string, CreatorBadges>).data;

export const featuredFirst = <T extends { id: string }>(list: T[], featured: FeaturedCreator[]) => {
  const rank = new Map(featured.map((f, i) => [f.creatorProfileId, i]));
  return [...list].sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity));
};
