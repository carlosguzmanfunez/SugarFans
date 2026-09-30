// UI access to likes, comments, tips, uploads and live rooms. Mutations tell
// mounted screens to reload (same listener set as the platform features).
import { backend } from './backend';
import type { AuthResult, User } from './backend/types';
import { platformChanged } from './platform';

export type * from './backend/socialTypes';

const s = backend.social;
export const socialApi = s;

const after = async <T extends AuthResult>(result: Promise<T>): Promise<T> => {
  const r = await result;
  if (r.ok) platformChanged();
  return r;
};

export const setLike = (user: User, postId: string, liked: boolean) => after(s.setLike(user, postId, liked));
export const addComment = (user: User, postId: string, creatorProfileId: string, body: string) =>
  after(s.addComment(user, postId, creatorProfileId, body));
export const deleteComment = (user: User, commentId: string) => after(s.deleteComment(user, commentId));
export const sendTip = (
  user: User,
  creatorProfileId: string,
  creatorName: string,
  amount: number,
  methodId: string,
  postId?: string,
  message?: string
) => after(backend.platform.sendTip(user, creatorProfileId, creatorName, amount, methodId, postId, message));

export const compactCount = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K` : String(n));
