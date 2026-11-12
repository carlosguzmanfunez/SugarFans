import React from 'react';
import { backend } from '../lib/backend';
import { usePlatformQuery } from '../lib/platform';
import { useLanguage } from '../context/LanguageContext';
import { BUNNY_LOW_BALANCE, BUNNY_PRICE, bunnyEstimate, formatAmount, type BunnyUsage } from '../lib/infraUsage';

// Admin "Consumo": Bunny Stream (post videos). Pay per use, so there is no limit bar:
// what it holds, what it served this month, what that costs and the balance left.
// Admin text: Spanish and English only (other site languages fall back to Spanish).
const TEXT = {
  es: {
    title: 'Bunny Stream · videos de publicaciones',
    intro: 'Se paga por uso: no tiene límite que corte el servicio. La recarga automática repone el saldo.',
    refresh: 'Actualizar',
    off: 'Bunny no está configurado en este servidor: los videos salen de Supabase.',
    error: 'No pudimos consultar Bunny. Prueba de nuevo en un momento.',
    loading: 'Consultando Bunny…',
    videos: 'Videos guardados',
    storage: 'Espacio usado',
    views: 'Vistas este mes',
    minutes: 'Minutos vistos este mes',
    served: 'Descarga servida este mes',
    charges: 'Cobrado este mes',
    balance: 'Saldo disponible',
    estimate: 'Costo estimado del mes',
    needKey: 'Falta la llave de la cuenta',
    keyHelp: 'Para ver la descarga, el cobro y el saldo, agrega BUNNY_ACCOUNT_API_KEY en Vercel (Bunny › Account settings › API key).',
    low: `Saldo bajo (menos de $${BUNNY_LOW_BALANCE}): revisa la tarjeta en Bunny.`,
    prices: `Precios: descarga $${BUNNY_PRICE.deliveryPerGb}/GB, espacio $${BUNNY_PRICE.storagePerGb}/GB al mes. La factura de Bunny es la que cuenta.`,
    open: 'Abrir Bunny',
  },
  en: {
    title: 'Bunny Stream · post videos',
    intro: 'Pay as you go: there is no limit that cuts service. Auto-recharge tops up the balance.',
    refresh: 'Refresh',
    off: 'Bunny is not configured on this server: videos are served from Supabase.',
    error: "We couldn't reach Bunny. Try again in a moment.",
    loading: 'Checking Bunny…',
    videos: 'Stored videos',
    storage: 'Storage used',
    views: 'Views this month',
    minutes: 'Minutes watched this month',
    served: 'Bandwidth served this month',
    charges: 'Charged this month',
    balance: 'Available balance',
    estimate: 'Estimated cost this month',
    needKey: 'Account key missing',
    keyHelp: 'To see bandwidth, charges and balance, add BUNNY_ACCOUNT_API_KEY in Vercel (Bunny › Account settings › API key).',
    low: `Low balance (under $${BUNNY_LOW_BALANCE}): check the card on Bunny.`,
    prices: `Prices: delivery $${BUNNY_PRICE.deliveryPerGb}/GB, storage $${BUNNY_PRICE.storagePerGb}/GB a month. Bunny's invoice is what counts.`,
    open: 'Open Bunny',
  },
};

const usd = (n: number) => `$${n.toFixed(n > 0 && n < 1 ? 3 : 2)}`;

const AdminBunnyUsage: React.FC = () => {
  const { language } = useLanguage();
  const tx = TEXT[language === 'en' ? 'en' : 'es'];
  const locale = language === 'en' ? 'en-US' : 'es';
  const { data, loading, error, reload } = usePlatformQuery(() => backend.bunnyUsage(), [], null as BunnyUsage | null);

  const tile = (label: string, value: string, testId: string, tone = 'text-gray-900') => (
    <div className="rounded-xl bg-gray-50 p-4" data-testid={testId}>
      <p className="text-xs text-gray-600">{label}</p>
      <p className={`text-xl font-bold ${tone}`}>{value}</p>
    </div>
  );
  const low = !!data?.account && data.balance !== null && data.balance < BUNNY_LOW_BALANCE;

  return (
    <div className="bg-white rounded-2xl shadow-sm p-5 sm:p-6" data-testid="infra-bunny">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
        <div>
          <h2 className="text-xl font-bold mb-1">{tx.title}</h2>
          <p className="text-sm text-gray-500">{tx.intro}</p>
        </div>
        <div className="flex gap-2 self-start">
          <a href="https://dash.bunny.net/account/billing" target="_blank" rel="noreferrer" className="px-3 py-1.5 rounded-full text-sm bg-gray-50 text-gray-600 hover:bg-gray-100">
            {tx.open} <i aria-hidden="true" className="fas fa-external-link-alt ml-1 text-xs"></i>
          </a>
          <button type="button" onClick={reload} className="px-3 py-1.5 rounded-full text-sm bg-gray-50 text-gray-600 hover:bg-gray-100">
            <i aria-hidden="true" className="fas fa-sync-alt mr-1"></i> {tx.refresh}
          </button>
        </div>
      </div>
      {loading ? (
        <p className="text-sm text-gray-500" role="status">{tx.loading}</p>
      ) : error ? (
        <p className="text-sm text-red-700" role="alert">{tx.error}</p>
      ) : !data?.enabled ? (
        <p className="text-sm text-gray-500" data-testid="bunny-off">{tx.off}</p>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {tile(tx.videos, data.videos.toLocaleString(locale), 'bunny-videos')}
            {tile(tx.storage, formatAmount(data.storageBytes, 'bytes'), 'bunny-storage')}
            {tile(tx.views, data.viewsMonth.toLocaleString(locale), 'bunny-views')}
            {tile(tx.minutes, formatAmount(data.watchMinutesMonth, 'minutes'), 'bunny-minutes')}
            {data.account && tile(tx.served, data.bandwidthBytesMonth === null ? '—' : formatAmount(data.bandwidthBytesMonth, 'bytes'), 'bunny-served')}
            {data.account && tile(tx.charges, data.chargesMonth === null ? '—' : usd(data.chargesMonth), 'bunny-charges')}
            {data.account && tile(tx.balance, data.balance === null ? '—' : usd(data.balance), 'bunny-balance', low ? 'text-red-600' : 'text-gray-900')}
            {tile(tx.estimate, usd(bunnyEstimate(data)), 'bunny-estimate')}
          </div>
          {!data.account && (
            <p className="mt-3 text-xs text-amber-700" data-testid="bunny-need-key">
              <strong>{tx.needKey}.</strong> {tx.keyHelp}
            </p>
          )}
          {low && <p className="mt-3 text-xs text-red-700" role="alert" data-testid="bunny-low">{tx.low}</p>}
          <p className="mt-3 text-xs text-gray-500">{tx.prices}</p>
        </>
      )}
    </div>
  );
};

export default AdminBunnyUsage;
