import { useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { backend } from '../lib/backend';
import { clearInviteCode, readInviteCode } from '../lib/prospectInvite';

// Right after a creator we invited signs up or signs in (wherever they land), links
// their account to the invite they opened. Silent: it only updates "Captar creadores".
const ProspectInviteClaimer: React.FC = () => {
  const { user } = useAuth();
  const busy = useRef(false);

  useEffect(() => {
    if (!user || user.role === 'admin' || user.signupCompleted === false || busy.current) return;
    const code = readInviteCode();
    if (!code) return;
    busy.current = true;
    backend.prospects.claim(code).then(() => {
      clearInviteCode();
      busy.current = false;
    }, () => { busy.current = false; });
  }, [user]);

  return null;
};

export default ProspectInviteClaimer;
