import { useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { creators } from '../data/mockData';
import { platformApi, platformChanged } from '../lib/platform';

const creatorNames = Object.fromEntries(creators.map((c) => [c.id, c.name]));

// Bills subscription renewals that came due while the user was away (monthly, same date).
const PlatformSync: React.FC = () => {
  const { user } = useAuth();
  useEffect(() => {
    if (user?.subscriptions.length) platformApi.billDueRenewals(user, creatorNames).then(platformChanged);
  }, [user]);
  return null;
};

export default PlatformSync;
