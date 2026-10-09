import React, { useState } from 'react';
import type { User } from '../context/AuthContext';
import type { Engagement, MediaType } from '../lib/social';
import { setLike, compactCount } from '../lib/social';
import CommentsPanel from './CommentsPanel';
import Avatar from './Avatar';
import { CoverImage, isPlaceholderImage } from './CoverArt';

// A post from the demo catalogue or one a creator published from their panel.
export interface DisplayPost {
  id: string;
  creatorProfileId: string;
  creatorName: string;
  creatorAvatar: string;
  content: string;
  mediaUrl?: string;
  mediaType?: MediaType;
  isLocked: boolean;
  price?: number;
  createdAt: string;
  // Counts the demo catalogue ships with; real likes/comments add to them.
  baseLikes: number;
  baseComments: number;
  // Only its author sees it until they verify their identity.
  isDraft?: boolean;
}

interface Props {
  post: DisplayPost;
  engagement?: Engagement;
  viewer: User | null;
  canView: boolean; // unlocked, subscribed, or the creator's own post
  isOwner: boolean;
  subscribeLabel: string;
  onSubscribe: () => void;
  onNeedLogin: () => void;
  onTip: () => void;
  onGift?: () => void;
  onReport: () => void;
  onDelete?: () => void; // the author, or an admin on a platform-run profile
}

const PostCard: React.FC<Props> = ({ post, engagement, viewer, canView, isOwner, subscribeLabel, onSubscribe, onNeedLogin, onTip, onGift, onReport, onDelete }) => {
  const [showComments, setShowComments] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const liked = !!engagement?.likedByMe;
  const likes = post.baseLikes + (engagement?.likes ?? 0);
  const comments = post.baseComments + (engagement?.comments ?? 0);

  const toggleLike = async () => {
    if (!viewer) return onNeedLogin();
    if (!canView) return setError('Suscríbete para interactuar con este contenido');
    const result = await setLike(viewer, post.id, !liked);
    setError(result.ok ? '' : result.error || 'No se pudo guardar');
  };

  const toggleComments = () => {
    if (!canView) return setError('Suscríbete para ver y escribir comentarios');
    setError('');
    setShowComments(!showComments);
  };

  const share = async () => {
    const url = `${window.location.origin}/creator/${post.creatorProfileId}#post-${post.id}`;
    try {
      if (navigator.share) await navigator.share({ title: post.creatorName, url });
      else await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // share sheet dismissed
    }
  };

  const media = post.mediaUrl && canView
    ? post.mediaType === 'video'
      ? <video src={post.mediaUrl} controls playsInline preload="metadata" className="w-full max-h-[32rem] bg-black" data-testid="post-video" />
      : isPlaceholderImage(post.mediaUrl)
        ? <CoverImage seed={`post-${post.id}`} className="w-full h-72" />
        : <img src={post.mediaUrl} alt="" className="w-full max-h-[32rem] object-cover" data-testid="post-image" />
    : post.mediaUrl || post.mediaType
      ? <CoverImage seed={`post-${post.id}`} className="w-full h-72" />
      : null;

  return (
    <div id={`post-${post.id}`} data-testid="post" className="bg-white rounded-2xl shadow-sm overflow-hidden">
      <div className="p-4 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <Avatar src={post.creatorAvatar} name={post.creatorName} size={40} decorative />
          <div>
            <p className="font-medium text-gray-900 text-sm">{post.creatorName}</p>
            <p className="text-xs text-gray-500">{new Date(post.createdAt).toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
          </div>
        </div>
        {post.isDraft ? (
          <span data-testid="draft-badge" className="bg-gray-100 text-gray-600 px-3 py-1 rounded-full text-xs font-medium" title="Se publica cuando verifiques tu identidad">
            <i aria-hidden="true" className="fas fa-eye-slash mr-1"></i>Borrador: solo tú lo ves
          </span>
        ) : post.isLocked && (canView ? (
          <span className="bg-pink-50 text-pink-600 px-3 py-1 rounded-full text-xs font-medium"><i aria-hidden="true" className="fas fa-star mr-1"></i>Exclusivo</span>
        ) : (
          <span className="bg-yellow-100 text-yellow-700 px-3 py-1 rounded-full text-xs font-medium">
            <i aria-hidden="true" className="fas fa-lock mr-1"></i>{post.price ? `$${post.price}` : 'Suscriptores'}
          </span>
        ))}
      </div>
      <div className="relative">
        {media}
        {!canView && (
          <div className={`${media ? 'absolute inset-0' : 'py-10'} bg-black/60 backdrop-blur-sm flex items-center justify-center`}>
            <div className="text-center text-white p-6">
              <i aria-hidden="true" className="fas fa-lock text-4xl mb-3"></i>
              <p className="font-bold text-lg">Contenido exclusivo para suscriptores</p>
              <p className="text-sm mt-2 text-pink-200">Suscríbete para desbloquear todo el contenido</p>
              {!isOwner && (
                <button onClick={onSubscribe} className="mt-4 bg-gradient-to-r from-pink-500 to-purple-600 text-white px-6 py-2 rounded-full font-medium hover:opacity-90">
                  {subscribeLabel}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
      <div className="p-4">
        {post.content && <p className="text-gray-700 whitespace-pre-line">{post.content}</p>}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mt-4 text-gray-500">
          <button
            onClick={toggleLike}
            aria-pressed={liked}
            aria-label={liked ? 'Quitar me gusta' : 'Me gusta'}
            className={`flex items-center text-sm transition ${liked ? 'text-pink-600' : 'hover:text-pink-500'}`}
          >
            <i aria-hidden="true" className={`${liked ? 'fas' : 'far'} fa-heart mr-1`}></i> <span data-testid="like-count">{compactCount(likes)}</span>
          </button>
          <button onClick={toggleComments} aria-expanded={showComments} aria-label="Comentarios" className={`flex items-center text-sm transition ${showComments ? 'text-pink-600' : 'hover:text-pink-500'}`}>
            <i aria-hidden="true" className="fas fa-comment mr-1"></i> <span data-testid="comment-count">{compactCount(comments)}</span>
          </button>
          {!isOwner && (
            <button onClick={() => (viewer ? onTip() : onNeedLogin())} className="flex items-center text-sm hover:text-pink-500 transition">
              <i aria-hidden="true" className="fas fa-hand-holding-usd mr-1"></i> Propina
            </button>
          )}
          {!isOwner && onGift && (
            <button onClick={() => (viewer ? onGift() : onNeedLogin())} className="flex items-center text-sm hover:text-pink-500 transition">
              <i aria-hidden="true" className="fas fa-gift mr-1"></i> Regalo
            </button>
          )}
          <button onClick={share} className="flex items-center text-sm hover:text-pink-500 transition ml-auto">
            <i aria-hidden="true" className="fas fa-share mr-1"></i> {copied ? 'Enlace copiado' : 'Compartir'}
          </button>
          {onDelete && (
            <button onClick={onDelete} className="flex items-center text-sm hover:text-red-500 transition" aria-label="Eliminar publicación">
              <i aria-hidden="true" className="fas fa-trash mr-1"></i> Eliminar
            </button>
          )}
          {!isOwner && (
            <button onClick={onReport} className="flex items-center text-sm hover:text-red-500 transition" aria-label="Reportar publicación">
              <i aria-hidden="true" className="fas fa-flag mr-1"></i> Reportar
            </button>
          )}
        </div>
        {error && <p role="alert" className="text-sm text-red-600 mt-3">{error}</p>}
        {showComments && canView && (
          <CommentsPanel postId={post.id} creatorProfileId={post.creatorProfileId} viewer={viewer} isOwner={isOwner} onNeedLogin={onNeedLogin} />
        )}
      </div>
    </div>
  );
};

export default PostCard;
