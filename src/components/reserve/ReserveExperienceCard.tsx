import React from 'react';
import { Link } from 'react-router-dom';
import { needsApproval, typeOf, type VipExperience } from '../../lib/vip';
import { ExperienceFacts, PriceTag } from './ReserveBits';
import Avatar from '../Avatar';

interface Props {
  exp: VipExperience;
  onDetails: () => void;
  onBook: () => void;
  // On the Reserve page each card names its creator; on a profile it doesn't.
  creator?: { name: string; avatar: string; id: string };
  isOwner?: boolean;
}

// A defined experience: what it is, how, how long, where, for how much, and
// whether the creator approves it first ("Solicitar") or it confirms at once ("Reservar").
const ReserveExperienceCard: React.FC<Props> = ({ exp, onDetails, onBook, creator, isOwner }) => {
  const type = typeOf(exp.type);
  const approval = needsApproval(exp);
  return (
    <article data-testid="reserve-card" aria-label={exp.title} className="group flex h-full flex-col rounded-2xl border border-line bg-white p-5 shadow-sm transition-[box-shadow,transform] hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)]">
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-gold-100 to-gold-300 text-night-900">
          <i aria-hidden="true" className={`fas ${type.icon}`}></i>
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-700">{type.name}</p>
          <h3 className="mt-0.5 text-base font-bold leading-snug text-ink">{exp.title}</h3>
        </div>
      </div>
      {creator && (
        <Link to={`/creator/${creator.id}`} className="mt-3 inline-flex items-center gap-2 self-start rounded-full py-0.5 pr-2 text-sm font-medium text-ink/80 hover:text-ink">
          <Avatar src={creator.avatar} name={creator.name} size={24} decorative />
          {creator.name}
        </Link>
      )}
      <p className="mt-3 line-clamp-2 text-sm text-ink/70">{exp.description}</p>
      <div className="mt-3">
        <ExperienceFacts exp={exp} compact />
      </div>
      <div className="mt-auto flex flex-wrap items-end justify-between gap-3 pt-4">
        <PriceTag exp={exp} />
        <div className="flex gap-2">
          <button type="button" onClick={onDetails} className="h-10 rounded-full border border-line px-4 text-sm font-semibold text-ink hover:border-ink/30">
            Ver detalles
          </button>
          {!isOwner && (
            <button type="button" onClick={onBook} aria-label={`${approval ? 'Solicitar' : 'Reservar'}: ${exp.title}`} className="h-10 rounded-full bg-ink px-4 text-sm font-semibold text-white hover:bg-night-800">
              {approval ? 'Solicitar' : 'Reservar'}
            </button>
          )}
        </div>
      </div>
    </article>
  );
};

export default ReserveExperienceCard;
