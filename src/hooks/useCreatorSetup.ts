import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { FIRST_STEPS_PATH, type CreatorSetupStep } from '../lib/creatorSetup';

// A fixed local destination: never treat a query parameter as a redirect URL.
export const useCreatorSetup = () => {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const step = user?.role === 'creator' ? params.get('setup') : null;
  const finish = (expected: CreatorSetupStep, message: string) => {
    if (step !== expected) return false;
    navigate(FIRST_STEPS_PATH, { replace: true, state: { creatorSetupNotice: message } });
    return true;
  };
  return { step, finish };
};
