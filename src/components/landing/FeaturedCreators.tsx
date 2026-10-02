import React from 'react';
import { Link } from 'react-router-dom';
import type { Creator } from '../../data/mockData';
import type { FeaturedCreator } from '../../lib/rewards';
import { featuredFirst } from '../../lib/rewards';
import { useVipCreatorIds } from '../../lib/catalog';
import { FEATURED } from '../../content/landing';
import CreatorCard from '../CreatorCard';
import SectionHeading from './SectionHeading';

const FeaturedCreators: React.FC<{ creators: Creator[]; featured: FeaturedCreator[] }> = ({ creators, featured }) => {
  // Creators featured by the rewards program (Oro, Diamante, monthly goals) come first.
  const level = new Map(featured.map((f) => [f.creatorProfileId, f.level]));
  const vip = useVipCreatorIds();
  const viewAll = (
    <Link to="/explore" className="btn btn-outline btn-md self-start md:self-auto">
      {FEATURED.viewAll} <i className="fas fa-arrow-right text-xs" aria-hidden="true"></i>
    </Link>
  );

  return (
    <section aria-labelledby="featured-title" className="reveal py-16 md:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionHeading id="featured-title" eyebrow={FEATURED.eyebrow} title={FEATURED.title} subtitle={FEATURED.subtitle} action={<span className="hidden md:block">{viewAll}</span>} />
        <div className="-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-4 scrollbar-hide sm:mx-0 sm:grid sm:grid-cols-2 sm:gap-6 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-3">
          {featuredFirst(creators, featured).slice(0, 6).map((creator) => (
            <CreatorCard
              key={creator.id}
              creator={creator}
              level={level.get(creator.id)}
              vip={vip.has(creator.id)}
              className="w-[82%] shrink-0 snap-start sm:w-auto"
            />
          ))}
        </div>
        <div className="mt-6 flex justify-center md:hidden">{viewAll}</div>
      </div>
    </section>
  );
};

export default FeaturedCreators;
