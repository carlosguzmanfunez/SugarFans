import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Room, RoomEvent, Track, type RemoteParticipant, type RemoteTrack } from 'livekit-client';
import { useAuth } from '../context/AuthContext';
import { liveApi, endLive, useCurrentLive } from '../lib/live';

interface ChatLine {
  id: number;
  name: string;
  text: string;
  mine: boolean;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
let lineId = 0;

// Free Live: one creator broadcasts camera and microphone, signed-in fans watch
// and chat. Video goes through LiveKit; the token comes from api/live-token.ts.
const LiveBroadcast: React.FC = () => {
  const { creatorId } = useParams<{ creatorId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const live = useCurrentLive(creatorId);
  const [checked, setChecked] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'connecting' | 'on' | 'ended' | 'error'>('idle');
  const [problem, setProblem] = useState('');
  const [host, setHost] = useState(false);
  const [hostName, setHostName] = useState('');
  const [hasVideo, setHasVideo] = useState(false);
  const [viewers, setViewers] = useState(0);
  const [needsAudio, setNeedsAudio] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [chat, setChat] = useState<ChatLine[]>([]);
  const [draft, setDraft] = useState('');
  const roomRef = useRef<Room | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const audioBox = useRef<HTMLDivElement>(null);

  // The live state loads after the first render; give it a moment before saying "not live".
  useEffect(() => {
    const t = setTimeout(() => setChecked(true), 1500);
    return () => clearTimeout(t);
  }, []);

  // Everyone in the room but the creator: the creator sees only fans; a fan sees
  // the creator plus the other fans, and counts themselves.
  const countViewers = (room: Room) => setViewers(room.remoteParticipants.size);

  const join = useCallback(async () => {
    if (!creatorId) return;
    setPhase('connecting');
    setProblem('');
    const r = await liveApi.broadcastAccess(creatorId);
    if (!r.ok || !r.access) {
      setProblem(r.error ?? 'No se pudo conectar al Live.');
      setPhase('error');
      return;
    }
    const { url, token, host: isHost } = r.access;
    const room = new Room({ adaptiveStream: true, dynacast: true });
    roomRef.current = room;
    setHost(isHost);

    room
      .on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub, participant: RemoteParticipant) => {
        setHostName(participant.name || '');
        if (track.kind === Track.Kind.Video && video.current) {
          track.attach(video.current);
          setHasVideo(true);
        } else if (track.kind === Track.Kind.Audio && audioBox.current) {
          audioBox.current.appendChild(track.attach());
        }
      })
      .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
        track.detach().forEach((el) => el !== video.current && el.remove());
        if (track.kind === Track.Kind.Video) setHasVideo(false);
      })
      .on(RoomEvent.ParticipantConnected, () => countViewers(room))
      .on(RoomEvent.ParticipantDisconnected, () => {
        countViewers(room);
        // Only the creator publishes: nobody left publishing means the Live is over.
        if (!isHost && [...room.remoteParticipants.values()].every((p) => p.trackPublications.size === 0)) setPhase('ended');
      })
      .on(RoomEvent.AudioPlaybackStatusChanged, () => setNeedsAudio(!room.canPlaybackAudio))
      .on(RoomEvent.DataReceived, (payload: Uint8Array, participant?: RemoteParticipant) => {
        try {
          const m = JSON.parse(decoder.decode(payload)) as { text?: string };
          if (m.text) setChat((c) => [...c.slice(-99), { id: ++lineId, name: participant?.name || 'Fan', text: m.text!.slice(0, 200), mine: false }]);
        } catch {
          // ignore malformed messages
        }
      })
      .on(RoomEvent.Disconnected, () => setPhase((p) => (p === 'on' ? 'ended' : p)));

    try {
      await room.connect(url, token);
      if (isHost) {
        await room.localParticipant.enableCameraAndMicrophone().catch(() => {
          setProblem('No pudimos usar tu cámara o tu micrófono. Revisa los permisos del navegador.');
        });
        const cam = room.localParticipant.getTrackPublication(Track.Source.Camera)?.track;
        if (cam && video.current) {
          cam.attach(video.current);
          setHasVideo(true);
        }
        setHostName(user?.name ?? '');
      }
      setNeedsAudio(!room.canPlaybackAudio);
      countViewers(room);
      setPhase('on');
    } catch (err) {
      console.warn('Live: no se pudo conectar', err);
      roomRef.current = null;
      setProblem('No se pudo conectar al Live. Revisa tu conexión e inténtalo de nuevo.');
      setPhase('error');
    }
  }, [creatorId, user?.name]);

  useEffect(
    () => () => {
      roomRef.current?.disconnect();
      roomRef.current = null;
    },
    []
  );

  const toggle = async (kind: 'mic' | 'cam') => {
    const lp = roomRef.current?.localParticipant;
    if (!lp) return;
    if (kind === 'mic') {
      await lp.setMicrophoneEnabled(!micOn);
      setMicOn(!micOn);
    } else {
      await lp.setCameraEnabled(!camOn);
      setCamOn(!camOn);
    }
  };

  const sendChat = (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft.trim().slice(0, 200);
    const room = roomRef.current;
    if (!text || !room) return;
    room.localParticipant.publishData(encoder.encode(JSON.stringify({ text })), { reliable: true });
    setChat((c) => [...c.slice(-99), { id: ++lineId, name: user?.name ?? 'Tú', text, mine: true }]);
    setDraft('');
  };

  const finish = async () => {
    if (host && user) await endLive(user);
    roomRef.current?.disconnect();
    roomRef.current = null;
    navigate(host ? '/creator/dashboard' : `/creator/${creatorId}`);
  };

  const backTo = host || user?.creatorProfileId === creatorId ? '/creator/dashboard' : `/creator/${creatorId}`;

  if (!live && phase !== 'on' && phase !== 'ended') {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4" data-testid="live-broadcast">
        {checked ? (
          <div className="max-w-md text-center">
            <i aria-hidden="true" className="fas fa-tower-broadcast text-4xl text-ink/30 mb-4"></i>
            <h1 className="text-xl font-bold text-ink mb-2">Este creator no está en Live ahora</h1>
            <p className="text-sm text-muted mb-6">Síguelo y deja la campanita activada para enterarte del próximo.</p>
            <Link to={backTo} className="btn btn-primary btn-md">Volver</Link>
          </div>
        ) : (
          <div role="status" aria-label="Cargando" className="w-10 h-10 border-4 border-pink-200 border-t-pink-500 rounded-full animate-spin"></div>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white" data-testid="live-broadcast">
      <div className="max-w-6xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-4 gap-3">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-red-400 font-bold flex items-center">
              <span className="w-2 h-2 rounded-full bg-red-500 mr-2 animate-pulse"></span>En vivo · Gratis
            </p>
            <h1 className="text-lg font-bold truncate">{live?.title ?? 'Live'}{hostName ? ` · ${hostName}` : ''}</h1>
          </div>
          {phase === 'on' && (
            <span data-testid="live-viewers" className="text-xs px-3 py-1 rounded-full bg-white/10 text-gray-200 whitespace-nowrap">
              <i aria-hidden="true" className="fas fa-eye mr-1"></i>{viewers}
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2">
            <div className="relative aspect-video bg-black rounded-2xl overflow-hidden">
              <video ref={video} autoPlay playsInline muted={host} className={`w-full h-full object-cover ${host ? '-scale-x-100' : ''} ${hasVideo ? '' : 'hidden'}`} />
              <div ref={audioBox} className="hidden" />
              {!hasVideo && (
                <div className="absolute inset-0 flex items-center justify-center text-center p-6">
                  {phase === 'idle' || phase === 'error' ? (
                    <div>
                      {problem && <p role="alert" data-testid="live-problem" className="mb-4 text-sm text-red-200">{problem}</p>}
                      <button onClick={join} className="px-6 py-3 rounded-xl bg-gradient-to-r from-pink-500 to-purple-600 font-medium">
                        {user?.creatorProfileId === creatorId ? 'Encender cámara y empezar' : 'Entrar al Live'}
                      </button>
                    </div>
                  ) : (
                    <p className="text-gray-300">
                      {phase === 'connecting' ? 'Conectando…' : phase === 'ended' ? 'El Live terminó.' : 'Esperando la imagen del creator…'}
                    </p>
                  )}
                </div>
              )}
              {needsAudio && phase === 'on' && !host && (
                <button onClick={() => roomRef.current?.startAudio()} className="absolute bottom-3 left-3 px-3 py-2 rounded-lg bg-white/90 text-gray-900 text-sm font-medium">
                  <i aria-hidden="true" className="fas fa-volume-high mr-1"></i>Activar sonido
                </button>
              )}
            </div>
            {problem && phase === 'on' && <p className="text-sm text-yellow-300 mt-3">{problem}</p>}
            <div className="flex justify-center gap-3 mt-4">
              {host && phase === 'on' && (
                <>
                  <button onClick={() => toggle('mic')} aria-label={micOn ? 'Silenciar micrófono' : 'Activar micrófono'} className={`w-12 h-12 rounded-full ${micOn ? 'bg-white/10 hover:bg-white/20' : 'bg-red-500'}`}>
                    <i aria-hidden="true" className={`fas ${micOn ? 'fa-microphone' : 'fa-microphone-slash'}`}></i>
                  </button>
                  <button onClick={() => toggle('cam')} aria-label={camOn ? 'Apagar cámara' : 'Encender cámara'} className={`w-12 h-12 rounded-full ${camOn ? 'bg-white/10 hover:bg-white/20' : 'bg-red-500'}`}>
                    <i aria-hidden="true" className={`fas ${camOn ? 'fa-video' : 'fa-video-slash'}`}></i>
                  </button>
                </>
              )}
              <button onClick={finish} className="px-6 h-12 rounded-full bg-red-600 hover:bg-red-700 font-medium">
                <i aria-hidden="true" className="fas fa-right-from-bracket mr-2"></i>{host ? 'Terminar Live' : 'Salir'}
              </button>
            </div>
          </div>

          <div className="bg-gray-800 rounded-2xl p-4 flex flex-col h-[24rem] lg:h-auto" data-testid="broadcast-chat">
            <h2 className="font-bold mb-3"><i aria-hidden="true" className="fas fa-comments mr-2"></i>Chat</h2>
            <div className="flex-1 overflow-y-auto space-y-2 text-sm">
              {chat.length === 0 && <p className="text-gray-400">Todos los que están en el Live ven estos mensajes.</p>}
              {chat.map((c) => (
                <div key={c.id} className={`max-w-[85%] px-3 py-2 rounded-xl ${c.mine ? 'ml-auto bg-pink-600' : 'bg-white/10'}`}>
                  <p className="text-[11px] opacity-70">{c.name}</p>
                  <p className="break-words">{c.text}</p>
                </div>
              ))}
            </div>
            <form onSubmit={sendChat} className="flex gap-2 mt-3">
              <input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={200} disabled={phase !== 'on'} aria-label="Mensaje" placeholder="Escribe un mensaje…" className="flex-1 min-w-0 px-3 py-2 rounded-xl bg-white/10 outline-none focus:ring-2 focus:ring-pink-500 text-sm disabled:opacity-50" />
              <button type="submit" disabled={phase !== 'on'} className="px-4 py-2 rounded-xl bg-pink-600 text-sm font-medium disabled:opacity-50">Enviar</button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LiveBroadcast;
