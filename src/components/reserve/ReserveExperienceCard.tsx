import React from 'react';
import { Link } from 'react-router-dom';
import { experienceCategory, needsApproval, reserveProductOf, typeOf, type VipExperience } from '../../lib/vip';
import { EventFacts, ExperienceFacts, PriceTag } from './ReserveBits';
import Avatar from '../Avatar';
import { experienceCopy, isFeaturedExperience, reserveTypeName, RESERVE_READING } from '../../content/reserveCatalog';
import { useReserveLanguage } from './ReserveLanguageSelector';
import type { Language } from '../../context/LanguageContext';

interface Props {
  exp: VipExperience;
  onDetails: () => void;
  onBook: () => void;
  // On the Reserve page each card names its creator; on a profile it doesn't.
  creator?: { name: string; avatar: string; id: string };
  isOwner?: boolean;
  // Reserve Event: seats already held.
  seatsTaken?: number;
}

// The button of each Reserve product, as the fan reads it.
export const bookLabel = (exp: VipExperience, language: Language = 'es') => {
  const approval = needsApproval(exp);
  const product = reserveProductOf(exp);
  const text = RESERVE_READING[language];
  // Two verbs only: "Reservar" books right away, "Solicitar" asks the creator.
  if (product === 'event') return text.seat;
  if (isFeaturedExperience(exp)) return approval ? text.requestTalk : text.talk;
  return approval ? text.request : text.book;
};

// A defined experience: what it is, how, how long, where, for how much, and
// whether the creator approves it first ("Solicitar") or it confirms at once ("Reservar").
const ReserveExperienceCard: React.FC<Props> = ({ exp, onDetails, onBook, creator, isOwner, seatsTaken = 0 }) => {
  const type = typeOf(exp.type);
  const language = useReserveLanguage();
  const copy = experienceCopy(exp, language);
  const text = RESERVE_READING[language];
  const typeName = reserveTypeName(exp.type, language, type.name);
  const featured = isFeaturedExperience(exp);
  const product = reserveProductOf(exp);
  const label = bookLabel(exp, language);
  const full = product === 'event' && seatsTaken >= (exp.details?.maxParticipants ?? 0);
  return (
    <article data-testid="reserve-card" aria-label={copy.title} className="group flex h-full flex-col rounded-2xl border border-line bg-white p-4 shadow-sm sm:p-5 transition-[box-shadow,transform] hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)]">
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-gold-100 to-gold-300 text-night-900">
          <i aria-hidden="true" className={`fas ${type.icon}`}></i>
        </span>
        <div className="min-w-0">
          <p lang={language} className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-700">
            {featured && <i aria-hidden="true" className="fas fa-star mr-1.5 text-gold-600" />}
            {product === 'event' ? `Reserve Event · ${typeName}` : product === 'one-to-one' ? `Reserve 1:1 · ${typeName}` : typeName}
          </p>
          <h3 lang={copy.language} className="mt-0.5 text-base font-bold leading-snug text-ink">{copy.title}</h3>
          {exp.details?.categoryId && <span data-testid="experience-category" className="mt-1 inline-block rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-ink/70">{experienceCategory(exp).name}</span>}
        </div>
      </div>
      {creator && (
        <Link to={`/creator/${creator.id}`} className="mt-3 inline-flex items-center gap-2 self-start rounded-full py-0.5 pr-2 text-sm font-medium text-ink/80 hover:text-ink">
          <Avatar src={creator.avatar} name={creator.name} size={24} decorative />
          {creator.name}
        </Link>
      )}
      <p lang={copy.language} className="mt-3 line-clamp-2 text-sm text-ink/70">{copy.description}</p>
      <div className="mt-3 space-y-1">
        {product === 'event' && <EventFacts exp={exp} seatsTaken={seatsTaken} />}
        <ExperienceFacts exp={exp} compact />
      </div>
      <div className="mt-auto flex flex-wrap items-end justify-between gap-3 pt-4">
        <PriceTag exp={exp} />
        <div lang={language} className="flex flex-wrap gap-2">
          <button type="button" onClick={onDetails} className="min-h-10 rounded-full border border-line px-4 py-2 text-sm font-semibold text-ink hover:border-ink/30">
            {text.details}
          </button>
          {!isOwner && (
            <button type="button" onClick={onBook} disabled={full} aria-label={`${full ? text.full : label}: ${copy.title}`} className="min-h-10 rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white hover:bg-night-800 disabled:opacity-50">
              {full ? text.full : label}
            </button>
          )}
        </div>
      </div>
    </article>
  );
};

export default ReserveExperienceCard;
