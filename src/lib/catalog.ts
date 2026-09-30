// The public creator catalogue: the demo creators plus the profiles the platform
// runs itself (managed profiles, e.g. AI personas), which are always labelled.
import { creators as demoCreators, type Creator } from '../data/mockData';
import { usePlatformQuery, platformApi, type ManagedProfile } from './platform';
import { backend } from './backend';

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

// A demo creator claimed by an account (e.g. creator@ owns '1') charges the price
// set in that account's panel, the same one the server bills.
const withOwnerPrices = async (list: Creator[]): Promise<Creator[]> => {
  const owners = await Promise.all(list.map((c) => backend.social.publicCreator(c.id)));
  return list.map((c, i) => (owners[i] ? { ...c, subscriptionPrice: owners[i]!.subscriptionPrice } : c));
};

export const useCreatorCatalog = () => {
  const { data, loading } = usePlatformQuery(
    async () => {
      const [demo, managed] = await Promise.all([withOwnerPrices(demoCreators), platformApi.managedProfiles()]);
      return [...demo, ...managed.map(fromManaged)];
    },
    [],
    demoCreators
  );
  return { creators: data, loading };
};
