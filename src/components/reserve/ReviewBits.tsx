import React, { useState } from 'react';
import { backend } from '../../lib/backend';
import type { ReserveReview, VipBooking } from '../../lib/vip';
import type { User } from '../../context/AuthContext';

// Five stars, filled up to the rating (rounded to the nearest half).
export const Stars: React.FC<{ rating: number; size?: string; label?: string }> = ({ rating, size = 'text-sm', label }) => {
  const r = Math.round(rating * 2) / 2;
  return (
    <span className={`inline-flex items-center gap-0.5 text-accent ${size}`} role="img" aria-label={label ?? `${rating} de 5 estrellas`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <i key={i} aria-hidden="true" className={i <= r ? 'fas fa-star' : i - 0.5 === r ? 'fas fa-star-half-stroke' : 'far fa-star text-ink/20'}></i>
      ))}
    </span>
  );
};

export const averageOf = (reviews: ReserveReview[]) =>
  reviews.length ? Math.round((reviews.reduce((s, r) => s + r.rating, 0) / reviews.length) * 10) / 10 : 0;

const when = (iso: string) => new Date(iso).toLocaleDateString('es', { month: 'long', year: 'numeric' });

// The fan rates an experience they lived; with a review already sent it shows it
// and lets them edit it.
export const ReviewBox: React.FC<{ booking: VipBooking; user: User; review?: ReserveReview; onSaved: () => void }> = ({ booking, user, review, onSaved }) => {
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(review?.rating ?? 0);
  const [comment, setComment] = useState(review?.comment ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const creator = booking.creatorName.split(' ')[0];

  const save = async () => {
    setBusy(true);
    const r = await backend.submitReview(user, booking.id, rating, comment);
    setBusy(false);
    if (!r.ok) return setError(r.error || 'No se pudo guardar tu reseña');
    setError('');
    setOpen(false);
    onSaved();
  };

  if (review && !open)
    return (
      <div className="mt-3 rounded-xl bg-canvas px-3 py-2.5 text-sm" data-testid="my-review">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2"><Stars rating={review.rating} /><span className="text-xs text-ink/60">Tu reseña</span></span>
          <button type="button" onClick={() => setOpen(true)} className="text-xs font-semibold text-brand-700 hover:underline">Editar</button>
        </div>
        {review.comment && <p className="mt-1 text-ink/75">“{review.comment}”</p>}
        {review.hidden && <p className="mt-1 text-xs text-ink/50">Oculta por moderación: solo tú la ves.</p>}
      </div>
    );

  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} data-testid="review-open"
        className="mt-3 flex w-full items-center justify-between gap-3 rounded-xl border border-dashed border-accent/60 bg-amber-50/40 px-3 py-2.5 text-left text-sm hover:bg-amber-50">
        <span><strong className="text-ink">¿Qué tal te fue con {creator}?</strong><span className="block text-xs text-ink/60">Tu reseña ayuda a otros fans a reservar con confianza.</span></span>
        <Stars rating={0} label="Calificar" />
      </button>
    );

  return (
    <div className="mt-3 space-y-2 rounded-xl border border-line bg-canvas p-3" data-testid="review-form">
      <p className="text-sm font-semibold text-ink">Califica tu experiencia con {creator}</p>
      <div className="flex gap-1" role="radiogroup" aria-label="Estrellas">
        {[1, 2, 3, 4, 5].map((i) => (
          <button key={i} type="button" role="radio" aria-checked={rating === i} aria-label={`${i} estrella${i === 1 ? '' : 's'}`} onClick={() => setRating(i)}
            className={`text-2xl transition ${i <= rating ? 'text-accent' : 'text-ink/20 hover:text-accent/60'}`}>
            <i aria-hidden="true" className="fas fa-star"></i>
          </button>
        ))}
      </div>
      <textarea name="reviewComment" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} rows={3}
        placeholder="Cuenta cómo fue: puntualidad, trato, lo que más te gustó (opcional)."
        className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm" />
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => setOpen(false)} className="h-9 rounded-full px-4 text-xs font-semibold text-ink/60">Cancelar</button>
        <button type="button" disabled={busy || rating < 1} onClick={save} className="h-9 rounded-full bg-ink px-4 text-xs font-semibold text-white disabled:opacity-40">
          {review ? 'Guardar cambios' : 'Publicar reseña'}
        </button>
      </div>
    </div>
  );
};

// A creator's reviews on their profile: average, count and the latest comments.
export const CreatorReviews: React.FC<{ reviews: ReserveReview[]; creatorName: string }> = ({ reviews, creatorName }) => {
  const [all, setAll] = useState(false);
  if (!reviews.length) return null;
  const shown = all ? reviews : reviews.slice(0, 3);
  return (
    <section className="mt-6" data-testid="creator-reviews" aria-label={`Reseñas de ${creatorName}`}>
      <div className="flex items-end justify-between gap-3">
        <div>
          <h3 className="font-display text-lg font-semibold text-ink">Lo que dicen sus fans</h3>
          <p className="mt-0.5 flex items-center gap-2 text-sm text-ink/70">
            <Stars rating={averageOf(reviews)} />
            <strong className="text-ink">{averageOf(reviews).toFixed(1)}</strong>
            <span>· {reviews.length} reseña{reviews.length === 1 ? '' : 's'} de experiencias realizadas</span>
          </p>
        </div>
      </div>
      <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((r) => (
          <li key={r.bookingId} className="rounded-2xl border border-line bg-white p-4">
            <Stars rating={r.rating} size="text-xs" />
            {r.comment && <p className="mt-2 text-sm leading-relaxed text-ink/80">“{r.comment}”</p>}
            <p className="mt-2 text-xs text-ink/50">{r.fanName} · {r.experienceTitle} · {when(r.createdAt)}</p>
          </li>
        ))}
      </ul>
      {reviews.length > 3 && (
        <button type="button" onClick={() => setAll(!all)} className="mt-3 text-sm font-semibold text-brand-700 hover:underline">
          {all ? 'Ver menos' : `Ver las ${reviews.length} reseñas`}
        </button>
      )}
    </section>
  );
};
