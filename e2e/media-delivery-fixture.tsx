// Internal, disconnected fixture. Never imported by the application.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import PostCard, { type DisplayPost } from '../src/components/PostCard';
import MediaViewer from '../src/components/MediaViewer';
import OnDemandVideo from '../src/components/OnDemandVideo';
import VideoPreview from '../src/components/VideoPreview';
import { CoverImage } from '../src/components/CoverArt';

const scenario = new URLSearchParams(location.search).get('scenario') || 'photos';
const post = (id: string, type: 'image' | 'video', locked = false): DisplayPost => ({
  id, creatorProfileId: 'test', creatorName: 'Creador de prueba', creatorAvatar: '',
  content: `Publicación de prueba ${id}`, mediaUrl: `/media/${id}.${type === 'image' ? 'svg' : 'webm'}`,
  mediaType: type, isLocked: locked, createdAt: '2026-10-29T12:00:00Z', baseLikes: 0, baseComments: 0,
});
const props = {
  viewer: null, isOwner: false, subscribeLabel: 'Suscribirme', onSubscribe() {},
  onNeedLogin() {}, onTip() {}, onReport() {},
};
const photos = Array.from({ length: 20 }, (_, i) => post(`photo-${i}`, 'image'));
const videos = Array.from({ length: 20 }, (_, i) => post(`video-${i}`, 'video'));
const onlyImage = [post('cover', 'image'), post('neighbor-a', 'video'), post('neighbor-b', 'video')];

const Fixture = () => {
  const [viewing, setViewing] = useState<string | null>(null);
  const [allowed, setAllowed] = useState(false);
  const [mounted, setMounted] = useState(true);
  const [revision, setRevision] = useState(1);
  return (
    <main className="max-w-2xl mx-auto px-4 py-4 space-y-4">
      <h1 className="font-bold text-lg">Prueba interna de archivos · datos ficticios</h1>
      {scenario === 'photos' && photos.map((p) => <PostCard key={p.id} {...props} post={p} canView onOpen={() => setViewing(p.id)} />)}
      {scenario === 'feed' && videos.map((p) => <PostCard key={p.id} {...props} post={p} canView onOpen={() => setViewing(p.id)} />)}
      {scenario === 'gallery' && <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {videos.map((p) => <button key={p.id} onClick={() => setViewing(p.id)} className="relative aspect-square" aria-label={`Abrir ${p.id}`}>
          <VideoPreview seed={`post-${p.id}`} className="w-full h-full" />
        </button>)}
      </div>}
      {scenario === 'viewer' && <button onClick={() => setViewing('cover')}>Abrir visor</button>}
      {scenario === 'inline' && <OnDemandVideo src={`/media/direct-${revision}.webm`} seed="direct" testId="direct-video" />}
      {scenario === 'inline' && <button onClick={() => setRevision((r) => r + 1)}>Cambiar video</button>}
      {scenario === 'locked' && <>
        <button onClick={() => setAllowed((v) => !v)}>{allowed ? 'Retirar acceso' : 'Autorizar acceso'}</button>
        <PostCard {...props} post={post('exclusive', 'video', true)} canView={allowed} />
        <PostCard {...props} post={post('exclusive-photo', 'image', true)} canView={allowed} />
      </>}
      {scenario === 'public' && <>
        <button onClick={() => setMounted((v) => !v)}>{mounted ? 'Ocultar foto' : 'Mostrar foto'}</button>
        <button onClick={() => setRevision((r) => r + 1)}>Cambiar foto</button>
        {mounted && <CoverImage key={revision} src={`/media/public-${revision}.svg`} seed="public" className="w-full h-72" />}
      </>}
      {scenario === 'fallback' && <CoverImage src="/media/photo-fallback.svg" seed="fallback" className="w-full h-72" />}
      {viewing && <MediaViewer posts={scenario === 'viewer' ? onlyImage : scenario === 'photos' ? photos : videos} startId={viewing} onClose={() => setViewing(null)} />}
    </main>
  );
};

createRoot(document.getElementById('root')!).render(<Fixture />);
