// The public creator catalogue: the demo creators plus the profiles the platform
// runs itself (managed profiles, e.g. AI personas), which are always labelled.
import { creators as demoCreators, type Creator } from '../data/mockData';
import { usePlatformQuery, platformApi, type ManagedProfile } from './platform';

export const fromManaged = (m: ManagedProfile): Creator => ({
  id: m.id,
  name: m.name,
  username: m.username,
  avatar: m.avatar,
  cover: m.cover,
  bio: m.bio,
  isVerified: false,
  subscriptionPrice: m.subscriptionPrice,
  followers: 0,
  likes: 0,
  postsCount: 0,
  category: m.category,
  tags: [],
  managed: m.isAi ? 'ai' : 'official',
});

export const useCreatorCatalog = () => {
  const { data, loading } = usePlatformQuery(() => platformApi.managedProfiles(), [], [] as ManagedProfile[]);
  return { creators: [...demoCreators, ...data.map(fromManaged)], loading };
};
