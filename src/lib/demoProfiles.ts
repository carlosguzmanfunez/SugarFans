import { creators as demoCreators } from '../data/mockData';

// The example creators (Valentina and the rest of the catalogue) show how Fans Reserve
// looks with real creators: their followers, posts and likes are made up and nobody
// can pay them. They say so wherever they appear, so nobody takes them for real people.
const DEMO_IDS = new Set(demoCreators.map((c) => c.id));

export const isDemoProfile = (creator: { id: string; managed?: string }) => DEMO_IDS.has(creator.id) && !creator.managed;
