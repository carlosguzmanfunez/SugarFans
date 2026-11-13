// The public creator catalogue: the demo creators, creators who signed up, and the
// profiles the platform runs itself (managed profiles, e.g. AI personas).
import { creators as demoCreators, type Creator } from '../data/mockData';
import { usePlatformQuery, platformApi, onPlatformChanged, type ManagedProfile } from './platform';
import { backend } from './backend';
import type { PublicCreator } from './backend/socialTypes';
import { BRAND } from '../config/brand';
import { usernameFrom } from './creatorLinks';
import { avatarOrEmpty } from './backend/shared';


export const fromManaged = (m: ManagedProfile): Creator => ({
  id: m.id,
  name: m.name,
  username: m.username,
  avatar: avatarOrEmpty(m.avatar),
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
  username: c.username || usernameFrom(c.name),
  avatar: avatarOrEmpty(c.avatar),
  cover: c.cover ?? '', // empty: generated cover art
  bio: c.bio || `Creador en ${BRAND.name}.`,
  isVerified: c.isVerified,
  subscriptionPrice: c.subscriptionPrice,
  followers: 0,
  likes: 0,
  postsCount: c.posts,
  category: c.category ?? '',
  tags: [],
});

// A demo creator claimed by an account (e.g. creator@ owns '1') charges the price
// set in that account's panel, the same one the server bills.
const withOwners = async (list: Creator[]): Promise<Creator[]> => {
  const owners = await Promise.all(list.map((c) => backend.social.publicCreator(c.id, { basic: true })));
  return list.map((c, i) => {
    const owner = owners[i];
    return owner ? { ...c, subscriptionPrice: owner.subscriptionPrice, isVerified: owner.isVerified } : c;
  });
};

const loadCatalog = async (): Promise<Creator[]> => {
  const [demo, signedUp, managed] = await Promise.all([
    withOwners(demoCreators),
    backend.social.publicCreators(),
    platformApi.managedProfiles(),
  ]);
  return [...demo, ...signedUp.map(fromPublic), ...managed.map(fromManaged)];
};

// Several screens use the catalog at once (the app shell, Inicio, Explorar...). They
// share one download for a short while instead of each asking the database again;
// any change on the platform (platformChanged) starts a fresh one.
const CATALOG_TTL_MS = 30_000;
let shared: { at: number; promise: Promise<Creator[]> } | null = null;
onPlatformChanged(() => { shared = null; });
export const sharedCatalog = (): Promise<Creator[]> => {
  if (!shared || Date.now() - shared.at > CATALOG_TTL_MS) {
    const promise = loadCatalog();
    shared = { at: Date.now(), promise };
    promise.catch(() => { if (shared?.promise === promise) shared = null; });
  }
  return shared.promise;
};

export const useCreatorCatalog = () => {
  const { data, loading } = usePlatformQuery(
    sharedCatalog,
    [],
    demoCreators
  );
  return { creators: data, loading };
};

// Creator profile id → country code (only creators who set one).
export const useCreatorCountries = () => {
  const { data } = usePlatformQuery(() => backend.social.creatorCountries(), [], {} as Record<string, string>);
  return data;
};

// Creators who currently offer bookable VIP experiences (VIP badge on cards).
export const useVipCreatorIds = () => {
  const { data } = usePlatformQuery(
    async () => new Set((await backend.listExperiences()).filter((e) => e.active).map((e) => e.creatorProfileId)),
    [],
    new Set<string>()
  );
  return data;
};
