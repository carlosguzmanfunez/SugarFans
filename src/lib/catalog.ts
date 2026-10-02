// The public creator catalogue: the demo creators, creators who signed up, and the
// profiles the platform runs itself (managed profiles, e.g. AI personas).
import { creators as demoCreators, type Creator } from '../data/mockData';
import { usePlatformQuery, platformApi, type ManagedProfile } from './platform';
import { backend } from './backend';
import type { PublicCreator } from './backend/socialTypes';
import { BRAND } from '../config/brand';

const DEFAULT_COVER = 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800&h=400&fit=crop';

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

export const fromPublic = (c: PublicCreator): Creator => ({
  id: c.id,
  name: c.name,
  username: c.name.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''),
  avatar: c.avatar,
  cover: DEFAULT_COVER,
  bio: c.bio || `Creador en ${BRAND.name}.`,
  isVerified: c.isVerified,
  subscriptionPrice: c.subscriptionPrice,
  followers: 0,
  likes: 0,
  postsCount: c.posts,
  category: '',
  tags: [],
});

// A demo creator claimed by an account (e.g. creator@ owns '1') charges the price
// set in that account's panel, the same one the server bills.
const withOwners = async (list: Creator[]): Promise<Creator[]> => {
  const owners = await Promise.all(list.map((c) => backend.social.publicCreator(c.id)));
  return list.map((c, i) => {
    const owner = owners[i];
    return owner ? { ...c, subscriptionPrice: owner.subscriptionPrice, isVerified: owner.isVerified } : c;
  });
};

export const useCreatorCatalog = () => {
  const { data, loading } = usePlatformQuery(
    async () => {
      const [demo, signedUp, managed] = await Promise.all([
        withOwners(demoCreators),
        backend.social.publicCreators(),
        platformApi.managedProfiles(),
      ]);
      return [...demo, ...signedUp.map(fromPublic), ...managed.map(fromManaged)];
    },
    [],
    demoCreators
  );
  return { creators: data, loading };
};
