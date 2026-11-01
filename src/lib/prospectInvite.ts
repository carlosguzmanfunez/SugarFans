// The personal invite link a creator opened (/c/<code>), kept in this browser until
// they have an account: ProspectInviteClaimer then links that account to the invite,
// so "Captar creadores" shows them as registered without anyone checking by hand.
import { readJSON, removeKey, writeJSON } from './storage';
import { INVITE_CODE } from './prospects';

const KEY = 'prospectInvite';

export const saveInviteCode = (code: string) => {
  if (INVITE_CODE.test(code)) writeJSON(KEY, code);
};
export const readInviteCode = () => {
  const code = readJSON<string>(KEY, '');
  return INVITE_CODE.test(code) ? code : '';
};
export const clearInviteCode = () => removeKey(KEY);
