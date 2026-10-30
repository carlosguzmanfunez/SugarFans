import { useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { platformApi, platformChanged } from '../lib/platform';
import { useCreatorCatalog } from '../lib/catalog';
import { reportError } from '../lib/errorReporting';

// Bills subscription renewals that came due while the user was away (monthly, same date).
const PlatformSync: React.FC = () => {
  const { user } = useAuth();
  const { creators, loading } = useCreatorCatalog();
  const checked = useRef('');
  useEffect(() => {
    if (!user || !user.subscriptions.length) { checked.current = ''; return; }
    if (loading) return;
    const snapshot = JSON.stringify([user.id, user.subscriptions]);
    if (checked.current === snapshot) return;
    // platformChanged reloads the catalogue and toggles `loading`. Mark this
    // snapshot before awaiting, so that reload cannot start another billing loop.
    checked.current = snapshot;
    platformApi.billDueRenewals(user, Object.fromEntries(creators.map((c) => [c.id, c.name])))
      .then(() => { if (checked.current === snapshot) platformChanged(); })
      .catch(() => reportError('No se pudo revisar la renovación de las suscripciones.'));
    // Runs once per subscription change; the catalogue only supplies display names.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, loading]);
  return null;
};

export default PlatformSync;
