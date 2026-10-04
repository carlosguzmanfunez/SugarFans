import React from 'react';
import { Link } from 'react-router-dom';
import type { Creator } from '../../data/mockData';
import { useLiveCreatorIds } from '../../lib/live';
import { categoryFor } from '../../config/reserve';
import { LIVE_NOW } from '../../content/landing';
import { LiveChip, clearAvatar } from './landingBits';

const BACKDROPS = [
  'radial-gradient(500px 300px at 70% 20%,#f7639b,transparent 60%),linear-gradient(150deg,#851244,#3e2483)',
  'linear-gradient(150deg,#3e2483,#21152d)',
  'linear-gradient(150deg,#b4701a,#21152d)',
  'linear-gradient(150deg,#c81b63,#2f2140)',
  'linear-gradient(150deg,#e5337a,#6d3ce6)',
];
const LIVE_CHAT = ['¡Qué buen Live!', 'Marta envió Rosas', '¿Haces Reserve este sábado?'];

// "Está pasando ahora": a stage of creators, whoever is in Live first and then the
// most followed. The big tile shows a Live as it feels: chat and rising gifts.
const HappeningNow: React.FC<{ creators: Creator[] }> = ({ creators }) => {
  const live = useLiveCreatorIds(creators.map((c) => c.id));
  const stage = [...creators]
    .filter((c) => c.avatar)
    .sort((a, b) => Number(live.has(b.id)) - Number(live.has(a.id)) || b.followers - a.followers)
    .slice(0, 5);

  return (
    <section className="sec" id="live" aria-labelledby="live-now-title" style={{ paddingTop: 64 }} data-testid="happening-now">
      <div className="wrap">
        <div className="sec-head v-reveal">
          <h2 id="live-now-title">{LIVE_NOW.title}</h2>
          <p>{LIVE_NOW.subtitle}</p>
        </div>
        <div className="stage v-reveal">
          {stage.map((c, i) => {
            const isLive = live.has(c.id);
            const clear = clearAvatar(c.avatar);
            const cat = categoryFor(c.category);
            return (
              <Link key={c.id} className={`tile ${i === 0 ? 'big' : ''}`} to={isLive ? `/en-vivo/${c.id}` : `/creator/${c.id}`}>
                <div className="bg" style={{ background: BACKDROPS[i % BACKDROPS.length] }} />
                {clear ? (
                  <img className="person" src={clear} alt="" />
                ) : (
                  <img className="person" src={c.avatar} alt="" style={{ height: '100%', width: '100%', objectFit: 'cover', left: 0, transform: 'none' }} />
                )}
                <div className="tl">{isLive ? <LiveChip /> : <span className="chip">{cat.name}</span>}</div>
                {i === 0 && isLive && (
                  <div className="chat" aria-hidden="true">
                    {LIVE_CHAT.map((m) => (
                      <span key={m}>{m}</span>
                    ))}
                  </div>
                )}
                {i === 0 && (
                  <div className="rise" aria-hidden="true">
                    <img src="/gifts/corazon.png" alt="" />
                    <img src="/gifts/rosas.png" alt="" style={{ animationDelay: '1.5s', right: -10 }} />
                    <img src="/gifts/fuego.png" alt="" style={{ animationDelay: '3s', right: 12 }} />
                  </div>
                )}
                <div className="who">
                  <div>
                    <b>{c.name}</b>
                    <span>{isLive ? 'En Live ahora' : cat.blurb}</span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
};

export default HappeningNow;
