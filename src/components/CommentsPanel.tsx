import React, { useState } from 'react';
import type { User } from '../context/AuthContext';
import { usePlatformQuery } from '../lib/platform';
import { socialApi, addComment, deleteComment } from '../lib/social';

interface Props {
  postId: string;
  creatorProfileId: string;
  viewer: User | null;
  isOwner: boolean; // the creator moderates comments on their posts
  onNeedLogin: () => void;
}

const CommentsPanel: React.FC<Props> = ({ postId, creatorProfileId, viewer, isOwner, onNeedLogin }) => {
  const { data: comments, loading } = usePlatformQuery(() => socialApi.comments(postId), [postId], []);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!viewer) return onNeedLogin();
    setSending(true);
    const result = await addComment(viewer, postId, creatorProfileId, text);
    setSending(false);
    if (!result.ok) return setError(result.error || 'No se pudo publicar el comentario');
    setError('');
    setText('');
  };

  const remove = async (id: string) => {
    if (!viewer) return;
    const result = await deleteComment(viewer, id);
    if (!result.ok) setError(result.error || 'No se pudo eliminar');
  };

  return (
    <div className="mt-4 border-t border-gray-100 pt-4" data-testid="comments">
      {loading ? (
        <p className="text-sm text-gray-400">Cargando comentarios…</p>
      ) : comments.length === 0 ? (
        <p className="text-sm text-gray-500 mb-3">Sé el primero en comentar.</p>
      ) : (
        <ul className="space-y-3 mb-4">
          {comments.map((c) => (
            <li key={c.id} data-testid="comment" className="flex items-start gap-3">
              <img src={c.userAvatar} alt="" className="w-8 h-8 rounded-full bg-gray-100" />
              <div className="flex-1 min-w-0 bg-gray-50 rounded-xl px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-gray-900">{c.userName}</p>
                  <span className="text-[11px] text-gray-400">{new Date(c.createdAt).toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <p className="text-sm text-gray-700 break-words whitespace-pre-line">{c.body}</p>
              </div>
              {viewer && (c.userId === viewer.id || isOwner || viewer.role === 'admin') && (
                <button onClick={() => remove(c.id)} aria-label="Eliminar comentario" className="p-1 text-gray-300 hover:text-red-500">
                  <i aria-hidden="true" className="fas fa-trash text-xs"></i>
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={submit} className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={500}
          placeholder={viewer ? 'Escribe un comentario…' : 'Inicia sesión para comentar'}
          aria-label="Escribe un comentario"
          className="flex-1 px-4 py-2 border border-gray-200 rounded-full text-sm focus:ring-2 focus:ring-pink-500 outline-none"
        />
        <button type="submit" disabled={sending || (!!viewer && !text.trim())} className="px-4 py-2 rounded-full bg-pink-500 text-white text-sm font-medium disabled:opacity-40">
          {viewer ? 'Comentar' : 'Entrar'}
        </button>
      </form>
      {error && <p role="alert" className="text-sm text-red-600 mt-2">{error}</p>}
    </div>
  );
};

export default CommentsPanel;
