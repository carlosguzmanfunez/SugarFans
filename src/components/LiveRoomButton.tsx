import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { sessionMinutes, liveState, liveWindow, type VipBooking } from '../lib/vip';

// "Join live session" for a confirmed booking of a live experience (one with a duration).
const LiveRoomButton: React.FC<{ booking: VipBooking }> = ({ booking }) => {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const minutes = sessionMinutes(booking);
  if (!minutes || booking.status !== 'confirmed') return null;

  const state = liveState(booking.date, booking.time, minutes, now);
  if (state === 'open') {
    return (
      <Link
        to={`/live/${booking.id}`}
        data-testid="join-live"
        className="text-xs px-3 py-1.5 rounded-lg bg-red-500 text-white font-medium hover:bg-red-600 inline-flex items-center"
      >
        <span className="w-2 h-2 rounded-full bg-white mr-2 animate-pulse"></span>Entrar a la sesión en vivo
      </Link>
    );
  }
  if (state === 'early') {
    const opens = liveWindow(booking.date, booking.time, minutes).opens;
    return (
      <span className="text-xs text-gray-500" data-testid="live-later">
        <i className="fas fa-video mr-1"></i>Sala en vivo disponible desde las{' '}
        {opens.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })} de ese día
      </span>
    );
  }
  return <span className="text-xs text-gray-400"><i className="fas fa-video-slash mr-1"></i>Sesión finalizada</span>;
};

export default LiveRoomButton;
