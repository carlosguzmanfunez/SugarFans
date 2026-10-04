import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Room, RoomEvent, Track, VideoPresets, type LocalVideoTrack, type RemoteParticipant, type RemoteTrack } from 'livekit-client';
import GiftDialog from '../components/GiftDialog';
import GiftCelebration from '../components/GiftCelebration';
import { giftById, type Gift } from '../lib/gifts';
import { useAuth } from '../context/AuthContext';
import CameraPreview from '../components/CameraPreview';
import LookPicker from '../components/LookPicker';
import { useCameraLook } from '../hooks/useCameraLook';
import ViewerWatermark, { noCaptureVideoProps } from '../components/ViewerWatermark';
import { backend } from '../lib/backend';
import { liveApi } from '../lib/live';
import { sessionMinutes, formatLongDate, liveState, liveWindow, type VipBooking } from '../lib/vip';

// 1:1 video call between the fan and the creator of a confirmed Reserve booking.
// Video, audio and chat go through LiveKit (like the free Live), so the call works
// on mobile data and strict networks too. The token comes from api/live-token.ts,
// which only lets in the booking's fan and creator. Nothing is recorded.
type CallMessage = { type: 'chat'; text: string; name: string; at: string } | { type: 'gift'; giftId: string; name: string };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

interface ChatLine {
  mine: boolean;
  name: string;
  text: string;
  at: string;
}

type Phase = 'loading' | 'unavailable' | 'lobby' | 'joining' | 'in-call';

const LiveRoom: React.FC = () => {
  const { bookingId = '' } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [booking, setBooking] = useState<VipBooking | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [problem, setProblem] = useState('');
  const [status, setStatus] = useState('');
  const [connected, setConnected] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [hasMedia, setHasMedia] = useState(false);
  const [needsAudio, setNeedsAudio] = useState(false);
  const [chat, setChat] = useState<ChatLine[]>([]);
  const [draft, setDraft] = useState('');
  const [gifting, setGifting] = useState(false);
  const [celebration, setCelebration] = useState<{ gift: Gift; caption: string } | null>(null);
  const [showLooks, setShowLooks] = useState(false);
  const cam = useCameraLook();
  const { bind: bindLook, captureOptions } = cam;

  const localVideo = useRef<HTMLVideoElement>(null);
  const remoteVideo = useRef<HTMLVideoElement>(null);
  const audioBox = useRef<HTMLDivElement>(null);
  const roomRef = useRef<Room | null>(null);

  const isCreator = !!booking && !!user?.creatorProfileId && user.creatorProfileId === booking.creatorProfileId;
  const otherName = booking ? (isCreator ? booking.fanName : booking.creatorName) : '';
  const minutes = sessionMinutes(booking) ?? 0;

  // Find the booking among mine (as fan or as creator).
  useEffect(() => {
    if (!user) return;
    let active = true;
    (async () => {
      const lists = await Promise.all([
        backend.fanBookings(user.id),
        user.creatorProfileId ? backend.creatorBookings(user.creatorProfileId) : Promise.resolve([]),
      ]);
      const b = lists.flat().find((x) => x.id === bookingId) ?? null;
      if (!active) return;
      setBooking(b);
      const mins = sessionMinutes(b);
      if (!b) setProblem('No encontramos esta reserva en tu cuenta.');
      else if (b.status !== 'confirmed') setProblem('La sala se abre cuando la reserva está aceptada y pagada.');
      else if (!mins) setProblem('Esta experiencia no es una sesión en vivo.');
      else if (liveState(b.date, b.time, mins) === 'early') {
        const opens = liveWindow(b.date, b.time, mins).opens;
        setProblem(`La sala se abre el ${formatLongDate(b.date)} a las ${opens.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}.`);
      } else if (liveState(b.date, b.time, mins) === 'over') setProblem('Esta sesión ya terminó.');
      setPhase(!b || b.status !== 'confirmed' || !mins || liveState(b.date, b.time, mins) !== 'open' ? 'unavailable' : 'lobby');
    })();
    return () => {
      active = false;
    };
  }, [user, bookingId]);

  const send = useCallback((m: CallMessage) => {
    roomRef.current?.localParticipant.publishData(encoder.encode(JSON.stringify(m)), { reliable: true }).catch(() => undefined);
  }, []);

  const leave = useCallback(() => {
    const room = roomRef.current;
    roomRef.current = null;
    bindLook(null);
    room?.disconnect();
  }, [bindLook]);

  useEffect(() => leave, [leave]);

  // Joins (or rejoins) the private LiveKit room of this booking with camera and microphone.
  const connect = useCallback(async (): Promise<string | null> => {
    if (!booking) return 'No encontramos esta reserva en tu cuenta.';
    leave();
    const r = await liveApi.callAccess(booking.id);
    if (!r.ok || !r.access) return r.error || 'No se pudo entrar a la sala';
    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
      videoCaptureDefaults: { resolution: VideoPresets.h1080.resolution },
      publishDefaults: { simulcast: true, videoSimulcastLayers: [VideoPresets.h360, VideoPresets.h720] },
    });
    roomRef.current = room;
    const otherHere = () => room.remoteParticipants.size > 0;

    room
      .on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
        if (track.kind === Track.Kind.Video && remoteVideo.current) track.attach(remoteVideo.current);
        else if (track.kind === Track.Kind.Audio && audioBox.current) audioBox.current.appendChild(track.attach());
      })
      .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
        track.detach().forEach((el) => el !== remoteVideo.current && el.remove());
      })
      .on(RoomEvent.ParticipantConnected, () => {
        setConnected(true);
        setStatus('');
      })
      .on(RoomEvent.ParticipantDisconnected, () => {
        if (otherHere()) return;
        setConnected(false);
        setStatus(`${otherName} salió de la sala. Puedes esperar a que vuelva.`);
      })
      .on(RoomEvent.Reconnecting, () => {
        setConnected(false);
        setStatus('Conexión inestable… reconectando.');
      })
      .on(RoomEvent.Reconnected, () => {
        setConnected(otherHere());
        setStatus(otherHere() ? '' : `Esperando a ${otherName}…`);
      })
      .on(RoomEvent.Disconnected, () => {
        if (roomRef.current !== room) return; // we left on purpose
        roomRef.current = null;
        setConnected(false);
        setStatus('Se perdió la conexión. Pulsa “Reconectar”.');
      })
      .on(RoomEvent.AudioPlaybackStatusChanged, () => setNeedsAudio(!room.canPlaybackAudio))
      .on(RoomEvent.DataReceived, (payload: Uint8Array, participant?: RemoteParticipant) => {
        let m: CallMessage;
        try {
          m = JSON.parse(decoder.decode(payload));
        } catch {
          return;
        }
        const name = participant?.name || otherName;
        if (m.type === 'chat' && typeof m.text === 'string') {
          setChat((c) => [...c, { mine: false, name, text: m.text.slice(0, 500), at: m.at }]);
        } else if (m.type === 'gift') {
          const gift = giftById(m.giftId);
          if (gift) setCelebration({ gift, caption: `¡${name} te envió ${gift.name}!` });
        }
      });

    try {
      await room.connect(r.access.url, r.access.token);
    } catch (err) {
      if (roomRef.current === room) roomRef.current = null;
      const detail = err instanceof Error ? err.message : String(err);
      return `No se pudo conectar al servidor de video. Inténtalo de nuevo. (Detalle: ${detail.slice(0, 160)})`;
    }
    // Camera and microphone; if the camera is refused, at least the microphone.
    const lp = room.localParticipant;
    // The chosen filter is set before publishing, so the other person never sees the raw camera.
    const camOpts = captureOptions();
    let cam = await lp.setCameraEnabled(true, camOpts).then(() => true, () => false);
    if (!cam && camOpts.processor) cam = await lp.setCameraEnabled(true).then(() => true, () => false);
    const mic = await lp.setMicrophoneEnabled(true).then(() => true, () => false);
    setHasMedia(cam || mic);
    setCamOn(cam);
    setMicOn(mic);
    const camTrack = lp.getTrackPublication(Track.Source.Camera)?.track as LocalVideoTrack | undefined;
    if (camTrack && localVideo.current) camTrack.attach(localVideo.current);
    bindLook(camTrack);
    setNeedsAudio(!room.canPlaybackAudio);
    setConnected(otherHere());
    setStatus(otherHere() ? '' : `Esperando a ${otherName}…`);
    return null;
  }, [booking, leave, otherName, captureOptions, bindLook]);

  const join = async () => {
    if (!user || !booking) return;
    setPhase('joining');
    setProblem('');
    const error = await connect();
    if (error) {
      setProblem(error);
      setPhase('lobby');
      return;
    }
    setPhase('in-call');
  };

  // The call view mounts after joining: show my camera in the small box and the
  // other person's picture and sound if they were already in the room.
  useEffect(() => {
    const room = roomRef.current;
    if (phase !== 'in-call' || !room) return;
    const cam = room.localParticipant.getTrackPublication(Track.Source.Camera)?.track;
    if (cam && localVideo.current) cam.attach(localVideo.current);
    room.remoteParticipants.forEach((p) =>
      p.trackPublications.forEach((pub) => {
        const track = pub.track;
        if (!track || track.attachedElements.length) return;
        if (track.kind === Track.Kind.Video && remoteVideo.current) track.attach(remoteVideo.current);
        else if (track.kind === Track.Kind.Audio && audioBox.current) audioBox.current.appendChild(track.attach());
      })
    );
  }, [phase, hasMedia, camOn]);

  const reconnect = async () => {
    setStatus('Reconectando…');
    const error = await connect();
    if (error) setStatus(`${error} Pulsa “Reconectar”.`);
  };

  const toggleTrack = async (kind: 'audio' | 'video') => {
    const lp = roomRef.current?.localParticipant;
    if (!lp) return;
    if (kind === 'audio') {
      await lp.setMicrophoneEnabled(!micOn).catch(() => undefined);
      setMicOn(lp.isMicrophoneEnabled);
    } else {
      await lp.setCameraEnabled(!camOn).catch(() => undefined);
      setCamOn(lp.isCameraEnabled);
    }
  };

  const hangUp = () => {
    leave();
    navigate(isCreator ? '/creator/dashboard?tab=vip' : '/profile');
  };

  const sendChat = (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !user) return;
    const at = new Date().toISOString();
    send({ type: 'chat', text, name: user.name, at });
    setChat((c) => [...c, { mine: true, name: user.name, text, at }]);
    setDraft('');
  };

  if (phase === 'loading') {
    return (
      <div className="min-h-[60vh] flex items-center justify-center" role="status" aria-label="Cargando">
        <div className="w-10 h-10 border-4 border-pink-200 border-t-pink-500 rounded-full animate-spin"></div>
      </div>
    );
  }

  if (phase === 'unavailable' || !booking) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4">
        <div className="text-center max-w-md" data-testid="live-unavailable">
          <i aria-hidden="true" className="fas fa-video-slash text-5xl text-gray-300 mb-4"></i>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Sala en vivo</h1>
          <p className="text-gray-600 mb-6">{problem}</p>
          <Link to={isCreator ? '/creator/dashboard?tab=vip' : '/profile'} className="bg-gradient-to-r from-pink-500 to-purple-600 text-white px-6 py-3 rounded-xl font-medium">
            Volver a mis reservas
          </Link>
        </div>
      </div>
    );
  }

  if (phase !== 'in-call') {
    return (
      <div className="min-h-[70vh] flex items-center justify-center px-4 bg-gray-50">
        <div className="bg-white rounded-2xl shadow-sm p-5 sm:p-8 max-w-md w-full text-center" data-testid="live-lobby">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-red-500 to-pink-500 flex items-center justify-center mx-auto mb-4">
            <i aria-hidden="true" className="fas fa-video text-white text-2xl"></i>
          </div>
          <h1 className="text-xl font-bold text-gray-900">{booking.title}</h1>
          <p className="text-gray-600 mt-1">con {otherName}</p>
          <p className="text-sm text-gray-500 mt-1 first-letter:uppercase">{formatLongDate(booking.date)} · {booking.time} · {minutes} min</p>
          <p className="text-sm text-gray-500 mt-4">Tu navegador te pedirá permiso para usar la cámara y el micrófono. La llamada es privada entre ustedes dos.</p>
          {phase === 'lobby' && (
            <div className="mt-5">
              <CameraPreview cam={cam} />
            </div>
          )}
          {problem && <p role="alert" className="mt-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{problem}</p>}
          <button
            onClick={join}
            disabled={phase === 'joining'}
            className="mt-6 w-full bg-gradient-to-r from-red-500 to-pink-600 text-white py-3 rounded-xl font-bold hover:opacity-90 disabled:opacity-50"
          >
            {phase === 'joining' ? 'Entrando…' : 'Entrar a la sala'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white" data-testid="live-room">
      <div className="max-w-6xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-4 gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-red-400 font-bold flex items-center">
              <span className="w-2 h-2 rounded-full bg-red-500 mr-2 animate-pulse"></span>En vivo
            </p>
            <h1 className="text-lg font-bold">{booking.title} · con {otherName}</h1>
          </div>
          <span data-testid="live-status" className={`text-xs px-3 py-1 rounded-full ${connected ? 'bg-green-500/20 text-green-300' : 'bg-white/10 text-gray-300'}`}>
            {connected ? 'Conectado' : 'Sin conexión'}
          </span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2">
            <div className="relative aspect-video bg-black rounded-2xl overflow-hidden">
              <video ref={remoteVideo} autoPlay playsInline {...noCaptureVideoProps} data-testid="remote-video" className="w-full h-full object-cover" />
              <div ref={audioBox} className="hidden" />
              {needsAudio && connected && (
                <button onClick={() => roomRef.current?.startAudio()} className="absolute top-3 left-3 z-10 px-3 py-2 rounded-lg bg-white/90 text-gray-900 text-sm font-medium">
                  <i aria-hidden="true" className="fas fa-volume-high mr-1"></i>Activar sonido
                </button>
              )}
              {connected && user && <ViewerWatermark name={user.name} userId={user.id} />}
              {!connected && (
                <div className="absolute inset-0 flex items-center justify-center text-center p-6">
                  <div>
                    <i aria-hidden="true" className="fas fa-user-clock text-4xl text-gray-500 mb-3"></i>
                    <p className="text-gray-300">{status}</p>
                    {/failed|Reconectar|salió/.test(status) && (
                      <button onClick={reconnect} className="mt-3 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm">Reconectar</button>
                    )}
                  </div>
                </div>
              )}
              <div className="absolute bottom-3 right-3 w-32 sm:w-44 aspect-video bg-gray-800 rounded-xl overflow-hidden border border-white/20">
                <video ref={localVideo} autoPlay playsInline muted data-testid="local-video" className={`w-full h-full object-cover -scale-x-100 ${hasMedia && camOn ? '' : 'hidden'}`} />
                {!(hasMedia && camOn) && (
                  <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs">
                    <i aria-hidden="true" className="fas fa-video-slash mr-1"></i>{hasMedia ? 'Cámara apagada' : 'Sin cámara'}
                  </div>
                )}
              </div>
            </div>
            {!hasMedia && (
              <p className="text-sm text-yellow-300 mt-3">
                <i aria-hidden="true" className="fas fa-exclamation-triangle mr-1"></i>
                No pudimos usar tu cámara ni tu micrófono. Revisa los permisos del navegador; mientras tanto puedes ver, escuchar y usar el chat.
              </p>
            )}
            {showLooks && hasMedia && camOn && <LookPicker cam={cam} className="mt-4" />}
            <div className="flex justify-center gap-3 mt-4">
              <button onClick={() => toggleTrack('audio')} disabled={!hasMedia} aria-label={micOn ? 'Silenciar micrófono' : 'Activar micrófono'} className={`w-12 h-12 rounded-full ${micOn ? 'bg-white/10 hover:bg-white/20' : 'bg-red-500'} disabled:opacity-40`}>
                <i aria-hidden="true" className={`fas ${micOn ? 'fa-microphone' : 'fa-microphone-slash'}`}></i>
              </button>
              <button onClick={() => toggleTrack('video')} disabled={!hasMedia} aria-label={camOn ? 'Apagar cámara' : 'Encender cámara'} className={`w-12 h-12 rounded-full ${camOn ? 'bg-white/10 hover:bg-white/20' : 'bg-red-500'} disabled:opacity-40`}>
                <i aria-hidden="true" className={`fas ${camOn ? 'fa-video' : 'fa-video-slash'}`}></i>
              </button>
              <button onClick={() => setShowLooks((v) => !v)} disabled={!hasMedia || !camOn} aria-label="Filtros de cámara" aria-expanded={showLooks} data-testid="looks-button" className={`w-12 h-12 rounded-full ${showLooks || cam.enhance || cam.look !== 'natural' ? 'bg-pink-600 hover:bg-pink-500' : 'bg-white/10 hover:bg-white/20'} disabled:opacity-40`}>
                <i aria-hidden="true" className="fas fa-wand-magic-sparkles"></i>
              </button>
              <button onClick={hangUp} aria-label="Salir de la llamada" className="px-6 h-12 rounded-full bg-red-600 hover:bg-red-700 font-medium">
                <i aria-hidden="true" className="fas fa-phone-slash mr-2"></i>Salir
              </button>
            </div>
          </div>

          <div className="bg-gray-800 rounded-2xl p-4 flex flex-col h-[28rem] lg:h-auto" data-testid="live-chat">
            <h2 className="font-bold mb-3"><i aria-hidden="true" className="fas fa-comments mr-2"></i>Chat</h2>
            <div className="flex-1 overflow-y-auto space-y-2 text-sm">
              {chat.length === 0 && <p className="text-gray-400">Los mensajes solo los ven ustedes dos.</p>}
              {chat.map((c, i) => (
                <div key={i} data-testid="chat-line" className={`max-w-[85%] px-3 py-2 rounded-xl ${c.mine ? 'ml-auto bg-pink-600' : 'bg-white/10'}`}>
                  <p className="text-[11px] opacity-70">{c.name}</p>
                  <p className="break-words">{c.text}</p>
                </div>
              ))}
            </div>
            <form onSubmit={sendChat} className="flex gap-2 mt-3">
              <input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={500} aria-label="Mensaje" placeholder="Escribe un mensaje…" className="flex-1 px-3 py-2 rounded-xl bg-white/10 outline-none focus:ring-2 focus:ring-pink-500 text-sm" />
              <button type="submit" className="px-4 py-2 rounded-xl bg-pink-600 text-sm font-medium">Enviar</button>
              {!isCreator && (
                <button type="button" onClick={() => setGifting(true)} aria-label="Regalar" title="Enviar un regalo" className="px-3 py-2 rounded-xl bg-white/10 text-sm">
                  <i aria-hidden="true" className="fas fa-gift"></i>
                </button>
              )}
            </form>
          </div>
        </div>
      </div>
      {gifting && user && booking && (
        <GiftDialog
          user={user}
          creatorProfileId={booking.creatorProfileId}
          creatorName={booking.creatorName}
          onSent={(gift) => {
            setGifting(false);
            const at = new Date().toISOString();
            const text = `${gift.icon} Envió ${gift.name}`;
            send({ type: 'chat', text, name: user.name, at });
            send({ type: 'gift', giftId: gift.id, name: user.name });
            setChat((c) => [...c, { mine: true, name: user.name, text, at }]);
            setCelebration({ gift, caption: `¡${gift.name} para ${booking.creatorName}!` });
          }}
          onClose={() => setGifting(false)}
        />
      )}
      {celebration && <GiftCelebration gift={celebration.gift} caption={celebration.caption} onDone={() => setCelebration(null)} />}
    </div>
  );
};

export default LiveRoom;
