import React from 'react';
import type { Creator } from '../../data/mockData';
import { useLiveCreatorIds } from '../../lib/live';
import { LiveRail, ReserveRail, RailHeading } from '../AppRails';

// "Ahora en Fans Reserve": who is in Live and what can be booked, in two
// swipeable rows, so the product shows up early instead of only being described.
const HappeningNow: React.FC<{ creators: Creator[] }> = ({ creators }) => {
  const liveIds = useLiveCreatorIds(creators.map((c) => c.id));
  return (
    <section aria-label="Ahora en Fans Reserve" className="py-12 md:py-16" data-testid="happening-now">
      <div className="mx-auto max-w-7xl space-y-10 px-4 sm:px-6 lg:px-8">
        <div>
          <RailHeading
            id="now-live-title"
            title={liveIds.size ? 'En Live ahora' : 'Creadores en Fans Reserve'}
            to={liveIds.size ? '/explore?live=1' : '/explore'}
            icon={liveIds.size ? 'fa-tower-broadcast' : 'fa-user-group'}
            tone={liveIds.size ? 'text-red-600' : 'text-brand-600'}
          />
          <LiveRail creators={creators} liveIds={liveIds} />
        </div>
        <div>
          <RailHeading id="now-reserve-title" title="Reserve disponible" to="/reserve" icon="fa-ticket" tone="text-gold-600" />
          <ReserveRail creators={creators} />
        </div>
      </div>
    </section>
  );
};

export default HappeningNow;
