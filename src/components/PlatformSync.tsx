import { useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { platformApi, platformChanged } from '../lib/platform';
import { useCreatorCatalog } from '../lib/catalog';

// Bills subscription renewals that came due while the user was away (monthly, same date).
const PlatformSync: React.FC = () => {
  const { user } = useAuth();
  const { creators, loading } = useCreatorCatalog();
  useEffect(() => {
    if (loading || !user?.subscriptions.length) return;
    platformApi.billDueRenewals(user, Object.fromEntries(creators.map((c) => [c.id, c.name]))).then(platformChanged);
    // Runs once per user change; the catalogue only supplies display names.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, loading]);
  return null;
};

export default PlatformSync;
