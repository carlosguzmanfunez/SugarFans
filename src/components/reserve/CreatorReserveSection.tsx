import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import type { User } from '../../context/AuthContext';
import type { VipExperience } from '../../lib/vip';
import { categoryFor } from '../../config/reserve';
import ReserveExperienceCard from './ReserveExperienceCard';
import ReserveBookingDialog from './ReserveBookingDialog';
import CustomExperienceRequest from './CustomExperienceRequest';
import { ReserveNotice } from './ReserveBits';

interface Props {
  creator: { id: string; name: string; category?: string };
  experiences: VipExperience[];
  user: User | null;
  isOwner: boolean;
  onNeedLogin: () => void;
}

// "Reserve con {creator}": the experiences this creator offers, each fully
// defined, plus a structured request for something tailored.
const CreatorReserveSection: React.FC<Props> = ({ creator, experiences, user, isOwner, onNeedLogin }) => {
  const [open, setOpen] = useState<{ exp: VipExperience; book: boolean } | null>(null);
  const [custom, setCustom] = useState(false);
  const first = creator.name.split(' ')[0];
  const category = categoryFor(creator.category);
  const canRequest = !isOwner && user?.role !== 'creator' && user?.role !== 'admin';

  return (
    <section id="reserve" aria-labelledby="reserve-title" className="mb-6 scroll-mt-24 rounded-3xl bg-white p-5 shadow-sm sm:p-6" data-testid="creator-reserve">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gold-700">Reserve · {category.name}</p>
          <h2 id="reserve-title" className="mt-1 text-xl font-bold text-ink sm:text-2xl">Reserve con {first}</h2>
          <p className="mt-1 text-sm text-ink/70">Experiencias con fecha, duración, precio y reglas definidas por {first}. Reservas experiencias, no personas.</p>
        </div>
        {isOwner && (
          <Link to="/creator/dashboard?tab=vip" className="inline-flex h-10 items-center rounded-full border border-line px-4 text-sm font-semibold text-ink">
            Gestionar Reserve
          </Link>
        )}
      </div>

      {experiences.length > 0 ? (
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {experiences.map((exp) => (
            <ReserveExperienceCard
              key={exp.id}
              exp={exp}
              isOwner={isOwner}
              onDetails={() => setOpen({ exp, book: false })}
              onBook={() => (user ? setOpen({ exp, book: true }) : onNeedLogin())}
            />
          ))}
        </div>
      ) : (
        <p className="mt-5 rounded-2xl border border-dashed border-line p-5 text-center text-sm text-muted">
          {isOwner ? 'Aún no publicas experiencias. Créalas desde tu panel.' : `${first} aún no publica experiencias. Puedes enviar una solicitud personalizada.`}
        </p>
      )}

      {canRequest && (
        <div className="mt-5 flex flex-col gap-3 rounded-2xl bg-gray-50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-ink">¿Buscas algo diferente?</p>
            <p className="text-xs text-ink/70">Propón modalidad, propósito, fecha y presupuesto. {first} acepta, rechaza o te hace una contraoferta.</p>
          </div>
          <button
            type="button"
            onClick={() => (user ? setCustom(true) : onNeedLogin())}
            className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-full border border-ink px-5 text-sm font-semibold text-ink hover:bg-ink hover:text-white"
          >
            <i aria-hidden="true" className="fas fa-wand-magic-sparkles"></i> Solicitar experiencia personalizada
          </button>
        </div>
      )}

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <ReserveNotice kind="subscription" />
        <ReserveNotice kind="gift" />
      </div>

      {open && <ReserveBookingDialog exp={open.exp} user={user} startBooking={open.book} onNeedLogin={onNeedLogin} onClose={() => setOpen(null)} />}
      {custom && user && <CustomExperienceRequest creator={creator} user={user} onClose={() => setCustom(false)} />}
    </section>
  );
};

export default CreatorReserveSection;
