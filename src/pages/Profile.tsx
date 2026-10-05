import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Link } from 'react-router-dom';
import { useCreatorCatalog } from '../lib/catalog';
import { formatLongDate, type VipBooking } from '../lib/vip';
import ReserveBookingCard from '../components/reserve/ReserveBookingCard';
import PushOptIn from '../components/PushOptIn';
import { onNewNotification } from '../lib/live';
import CheckoutDialog from '../components/CheckoutDialog';
import { backend } from '../lib/backend';
import { useBackendData } from '../lib/useBackendData';
import { usePlatformQuery, platformApi, platformChanged, nextRenewal } from '../lib/platform';
import { displayEmail } from '../config/demoAccounts';
import { VIRTUAL_CURRENCY } from '../config/currency';
import { formatCoins, giftsApi } from '../lib/gifts';
import Avatar from '../components/Avatar';

const formatDate = (iso: string) => new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });

const Profile: React.FC = () => {
  const { user, cancelSubscription } = useAuth();
  const { creators } = useCreatorCatalog();
  const { data: myBookings, reload } = useBackendData(() => (user ? backend.fanBookings(user.id) : Promise.resolve([])), [user?.id], []);
  // The creator's answer shows up at once.
  const userId = user?.id;
  useEffect(() => (userId ? onNewNotification(userId, reload) : undefined), [userId, reload]);
  const { data: verification } = usePlatformQuery(() => (user ? platformApi.myVerification(user.id) : Promise.resolve(null)), [user?.id], null);
  const { data: coins } = usePlatformQuery(() => (user ? giftsApi.wallet(user).then((w) => w.coins) : Promise.resolve(0)), [user?.id], 0);
  const [paying, setPaying] = useState<VipBooking | null>(null);

  if (!user) return null;

  const payBooking = async (methodId: string) => {
    const result = await backend.payBooking(user, paying!.id, methodId);
    if (result.ok) {
      setPaying(null);
      platformChanged();
      await reload();
    }
    return result;
  };

  const subscribedCreators = user.subscriptions.flatMap((sub) => {
    const creator = creators.find((c) => c.id === sub.creatorId);
    return creator ? [{ sub, creator }] : [];
  });

  return (
    <div className="min-h-screen bg-canvas">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Profile header: compact card, the useful things below it */}
        <div className="bg-white rounded-2xl border border-line p-5 sm:p-6 mb-6">
          <div className="flex items-center gap-4">
            <Avatar src={user.avatar} name={user.name} size={72} className="ring-4 ring-brand-50" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-display text-2xl font-bold tracking-tight text-ink">{user.name}</h1>
                {user.isVerified && (
                  <span className="inline-flex items-center rounded-full bg-iris-50 px-2 py-0.5 text-xs font-medium text-iris-700">
                    <i aria-hidden="true" className="fas fa-circle-check mr-1"></i>Verificado
                  </span>
                )}
                <span className="rounded-full bg-canvas px-2 py-0.5 text-xs font-medium text-ink/60">
                  {user.role === 'admin' ? 'Administrador' : user.role === 'creator' ? 'Creador' : 'Fan'}
                </span>
              </div>
              <p className="truncate text-sm text-ink/55">{displayEmail(user.email)}</p>
              {user.bio && <p className="text-ink/70 mt-1 text-sm">{user.bio}</p>}
            </div>
          </div>
            {user.role === 'creator' && (
              <div className="flex space-x-6 mt-4">
                <div className="text-center">
                  <p className="font-bold text-gray-900">{(user.followers ?? 0).toLocaleString()}</p>
                  <p className="text-xs text-gray-500">Seguidores</p>
                </div>
                <div className="text-center">
                  <p className="font-bold text-gray-900">{user.following ?? 0}</p>
                  <p className="text-xs text-gray-500">Siguiendo</p>
                </div>
                <div className="text-center">
                  <p className="font-bold text-gray-900">{user.posts ?? 0}</p>
                  <p className="text-xs text-gray-500">Posts</p>
                </div>
              </div>
            )}
            <div className="flex flex-wrap gap-2 mt-5">
              <Link to="/settings" className="btn btn-md btn-outline text-sm">
                <i aria-hidden="true" className="fas fa-pen text-ink/50"></i> Editar perfil
              </Link>
              <Link to="/settings?section=wallet" className="btn btn-md btn-outline text-sm" data-testid="profile-wallet">
                <i aria-hidden="true" className="fas fa-coins text-gold-600"></i> {VIRTUAL_CURRENCY.displayName}: {formatCoins(coins)}
              </Link>
              {user.role === 'creator' && (
                <Link to="/creator/dashboard" className="btn btn-md btn-primary text-sm">
                  <i aria-hidden="true" className="fas fa-chart-line"></i> Mi panel
                </Link>
              )}
            </div>
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-1 gap-4">
          <div id="mis-reservas" className="bg-white rounded-2xl border border-line p-5 scroll-mt-24" data-testid="bookings">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold text-ink">
                <i aria-hidden="true" className="fas fa-ticket text-brand-600 mr-2"></i> Mis reservas
              </h3>
              <Link to="/reserve" className="text-sm font-medium text-brand-700">Ver Reserve</Link>
            </div>
            {myBookings.length === 0 ? (
              <p className="text-sm text-gray-500">
                Aún no tienes reservas. <Link to="/reserve" className="text-pink-600">Ver experiencias</Link>
              </p>
            ) : (
              <div className="space-y-3">
                <PushOptIn user={user} />
                {myBookings.map((b) => (
                  <ReserveBookingCard key={b.id} booking={b} user={user} as="fan" testId="booking" onChanged={reload} onPay={setPaying} />
                ))}
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-line p-5" data-testid="subscriptions">
            <h3 className="font-semibold text-ink mb-3">
              <i aria-hidden="true" className="fas fa-star text-iris-600 mr-2"></i> Mis suscripciones
            </h3>
            {subscribedCreators.length === 0 ? (
              <p className="text-sm text-gray-500">
                No tienes suscripciones activas. <Link to="/explore" className="text-pink-600">Explorar creadores</Link>
              </p>
            ) : (
              <div className="space-y-3">
                {subscribedCreators.map(({ sub, creator }) => (
                  <div key={sub.creatorId} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                    <Link to={`/creator/${creator.id}`} className="flex items-center space-x-3">
                      <Avatar src={creator.avatar} name={creator.name} size={32} decorative />
                      <div>
                        <p className="text-sm font-medium text-gray-900">{creator.name}</p>
                        <p className="text-xs text-gray-500">
                          Desde {formatDate(sub.since)} · ${sub.price}/mes ·{' '}
                          {sub.cancelAt ? `Cancelada: acceso hasta ${formatDate(sub.cancelAt)}` : `Renueva ${formatDate(nextRenewal(sub.since).toISOString())}`}
                        </p>
                      </div>
                    </Link>
                    {!sub.cancelAt && (
                      <button
                        onClick={() => window.confirm(`¿Cancelar tu suscripción a ${creator.name}? Seguirás viendo su contenido hasta el final del mes que ya pagaste.`) && cancelSubscription(creator.id)}
                        className="text-xs text-red-600 hover:text-red-700"
                      >
                        Cancelar
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Account Info */}
        <div className="mt-6 bg-white rounded-2xl border border-line p-5">
          <h3 className="font-semibold text-ink mb-4">
            <i aria-hidden="true" className="fas fa-user text-ink/40 mr-2"></i> Tu cuenta
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-gray-500">Tipo de cuenta</p>
              <p className="font-medium text-gray-900">{user.role === 'admin' ? 'Administrador' : user.role === 'creator' ? 'Creador' : 'Fan'}</p>
            </div>
            <div>
              <p className="text-gray-500">Email</p>
              <p className="font-medium text-gray-900">{displayEmail(user.email)}</p>
            </div>
            <div>
              <p className="text-gray-500">Verificación de edad</p>
              {user.ageVerified ? (
                <p className="font-medium text-green-600"><i aria-hidden="true" className="fas fa-check-circle mr-1"></i> Verificado</p>
              ) : (
                <p className="font-medium text-yellow-600"><i aria-hidden="true" className="fas fa-clock mr-1"></i> Pendiente</p>
              )}
            </div>
            <div>
              <p className="text-gray-500">Verificación de identidad</p>
              {user.isVerified ? (
                <p className="font-medium text-green-600"><i aria-hidden="true" className="fas fa-check-circle mr-1"></i> Verificada</p>
              ) : verification?.status === 'pending' ? (
                <p className="font-medium text-yellow-600"><i aria-hidden="true" className="fas fa-clock mr-1"></i> En revisión</p>
              ) : (
                <Link to="/settings?section=verification" className="font-medium text-pink-600 hover:text-pink-700">
                  <i aria-hidden="true" className="fas fa-id-card mr-1"></i> {verification?.status === 'rejected' ? 'Rechazada · volver a enviar' : 'Verificar identidad'}
                </Link>
              )}
            </div>
            <div>
              <p className="text-gray-500">Miembro desde</p>
              <p className="font-medium text-gray-900">{new Date(user.createdAt).toLocaleDateString('es', { month: 'long', year: 'numeric' })}</p>
            </div>
          </div>
        </div>
      </div>
      {paying && (
        <CheckoutDialog
          user={user}
          title={`Pagar: ${paying.title}`}
          amount={paying.price}
          note={`Con ${paying.creatorName} · ${formatLongDate(paying.date)} · ${paying.time}`}
          confirmLabel="Confirmar pago"
          paypal={{ kind: 'booking', params: { bookingId: paying.id } }}
          onConfirm={payBooking}
          onClose={() => setPaying(null)}
        />
      )}
    </div>
  );
};

export default Profile;
