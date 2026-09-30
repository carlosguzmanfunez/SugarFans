import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { socialApi, type MediaType } from '../lib/social';
import { platformChanged } from '../lib/platform';
import { IMAGE_TYPES, VIDEO_TYPES, MAX_IMAGE_MB, MAX_VIDEO_MB, validateMedia } from '../lib/media';

interface Props {
  verified: boolean;
  asProfileId?: string; // admins publishing as a platform-run profile
  onPublished: () => void;
  onCancel?: () => void;
}

// Composer: text + one photo or video, public or subscribers-only. The file is
// uploaded first (Supabase Storage, or IndexedDB offline), then the post is saved.
const NewPostForm: React.FC<Props> = ({ verified, asProfileId, onPublished, onCancel }) => {
  const { user, addPost } = useAuth();
  const [text, setText] = useState('');
  const [locked, setLocked] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [fileType, setFileType] = useState<MediaType | null>(null);
  const [preview, setPreview] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<'' | 'upload' | 'save'>('');
  const imageInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const check = validateMedia(f);
    if (!check.type) return setError(check.error!);
    setError('');
    setFile(f);
    setFileType(check.type);
    setPreview(URL.createObjectURL(f));
  };

  const clearFile = () => {
    setFile(null);
    setFileType(null);
    setPreview('');
  };

  const publish = async () => {
    if (!user) return;
    if (!verified) return setError('Verifica tu identidad antes de publicar contenido');
    if (!text.trim() && !file) return setError('Escribe algo o añade una foto o video');
    setError('');
    let media;
    if (file) {
      setBusy('upload');
      const up = await socialApi.uploadMedia(user, file);
      if (!up.ok || !up.media) {
        setBusy('');
        return setError(up.error || 'No se pudo subir el archivo');
      }
      media = up.media;
    }
    setBusy('save');
    const result = await addPost(text, locked, media, asProfileId);
    setBusy('');
    if (!result.ok) {
      if (media) await socialApi.removeMedia(user, media.path);
      return setError(result.error || 'No se pudo publicar');
    }
    setText('');
    setLocked(false);
    clearFile();
    platformChanged();
    onPublished();
  };

  return (
    <div className="bg-white rounded-2xl shadow-lg p-6 border border-pink-100" data-testid="new-post">
      <h3 className="font-bold text-lg mb-1">Crear nueva publicación</h3>
      <p className="text-sm text-gray-500 mb-4">
        Sube una foto (hasta {MAX_IMAGE_MB} MB) o un video (hasta {MAX_VIDEO_MB} MB). Aparecerá en tu perfil público.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="w-full p-4 border border-gray-200 rounded-xl resize-none h-24 focus:ring-2 focus:ring-pink-500 outline-none"
        placeholder="¿Qué quieres compartir con tus fans?"
        aria-label="Texto de la publicación"
      ></textarea>

      {preview && (
        <div className="relative mt-3 rounded-xl overflow-hidden bg-black/5" data-testid="media-preview">
          {fileType === 'video' ? (
            <video src={preview} controls playsInline className="w-full max-h-80 bg-black" />
          ) : (
            <img src={preview} alt="Vista previa" className="w-full max-h-80 object-contain" />
          )}
          <button type="button" onClick={clearFile} aria-label="Quitar archivo" className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/60 text-white">
            <i className="fas fa-times"></i>
          </button>
          <p className="text-xs text-gray-500 px-3 py-2 bg-white">{file?.name} · {((file?.size ?? 0) / 1024 / 1024).toFixed(1)} MB</p>
        </div>
      )}

      <input ref={imageInput} type="file" accept={IMAGE_TYPES.join(',')} onChange={pick} className="hidden" data-testid="image-input" />
      <input ref={videoInput} type="file" accept={VIDEO_TYPES.join(',')} onChange={pick} className="hidden" data-testid="video-input" />

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mt-4">
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => imageInput.current?.click()} className="px-3 py-2 rounded-xl border border-gray-200 text-sm text-gray-700 hover:border-pink-300 hover:text-pink-600">
            <i className="fas fa-image mr-1"></i> Foto
          </button>
          <button type="button" onClick={() => videoInput.current?.click()} className="px-3 py-2 rounded-xl border border-gray-200 text-sm text-gray-700 hover:border-pink-300 hover:text-pink-600">
            <i className="fas fa-video mr-1"></i> Video
          </button>
          <button
            type="button"
            aria-pressed={locked}
            onClick={() => setLocked(!locked)}
            className={`px-3 py-2 rounded-xl border text-sm transition ${locked ? 'border-pink-500 bg-pink-50 text-pink-600 font-medium' : 'border-gray-200 text-gray-700 hover:border-pink-300'}`}
          >
            <i className="fas fa-lock mr-1"></i> Solo suscriptores{locked ? ' ✓' : ''}
          </button>
        </div>
        <div className="flex gap-2 justify-end">
          {onCancel && (
            <button type="button" onClick={onCancel} className="px-4 py-2 text-gray-600 hover:text-gray-800">
              Cancelar
            </button>
          )}
          <button
            type="button"
            onClick={publish}
            disabled={!!busy}
            className="bg-gradient-to-r from-pink-500 to-purple-600 text-white px-6 py-2 rounded-xl font-medium hover:opacity-90 disabled:opacity-50"
          >
            {busy === 'upload' ? 'Subiendo archivo…' : busy === 'save' ? 'Publicando…' : 'Publicar'}
          </button>
        </div>
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
    </div>
  );
};

export default NewPostForm;
