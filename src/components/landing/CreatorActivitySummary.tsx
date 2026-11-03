import React from 'react';
import { Link } from 'react-router-dom';
import Icon from '../Icon';
import { CREATOR_RESERVE_LINK } from '../../lib/reserveAlerts';

interface Props {
  ready: boolean;
  waiting: number;
  income: string | null;
  period: string | null;
  nextLevelName: string | null;
  levelName: string | null;
  progress: number | null;
}

// Presentation only: the home keeps its existing balances, calendar and rewards.
const CreatorActivitySummary: React.FC<Props> = ({ ready, waiting, income, period, nextLevelName, levelName, progress }) => {
  const pending = ready && waiting > 0;
  return (
    <nav className="creator-activity" aria-label="Tu actividad" data-testid="creator-activity">
      <Link to={CREATOR_RESERVE_LINK} className="creator-activity-item creator-activity-reserve" data-pending={pending} data-testid="ch-reservas">
        <span className="creator-activity-icon" aria-hidden="true"><Icon name="fa-ticket" /></span>
        <h2 className="creator-activity-title">Tus reservas</h2>
        <strong className="creator-activity-value">{!ready ? '—' : pending ? `${waiting} ${waiting === 1 ? 'pendiente' : 'pendientes'}` : 'Todo al día'}</strong>
        <p className="creator-activity-detail">{!ready ? 'Consultando solicitudes…' : pending ? 'Esperan tu respuesta.' : 'Sin pendientes.'}</p>
        <span className="creator-activity-action">{pending ? 'Responder' : 'Ver reservas'} <Icon name="fa-arrow-right" /></span>
      </Link>

      <Link to="/creator/dashboard?tab=earnings" className="creator-activity-item creator-activity-income" data-long-value={income !== null && income.length > 12} data-testid="ch-ganado">
        <span className="creator-activity-icon" aria-hidden="true"><Icon name="fa-wallet" /></span>
        <h2 className="creator-activity-title">Tus ganancias</h2>
        <strong className="creator-activity-value">{income ?? '—'}</strong>
        <p className="creator-activity-detail">{income === null ? 'Consultando tus ganancias…' : <>En acumulación{period && <span className="creator-activity-period"> {period}</span>}</>}</p>
        <span className="creator-activity-action">Ver mis ganancias <Icon name="fa-arrow-right" /></span>
      </Link>

      <Link to="/creator/dashboard?tab=goals#panel-tabs" className="creator-activity-item creator-activity-goal" data-testid="ch-metas">
        <span className="creator-activity-icon" aria-hidden="true"><Icon name="fa-medal" /></span>
        <h2 className="creator-activity-title">{levelName && !nextLevelName ? 'Tu nivel' : 'Tu próxima meta'}</h2>
        <strong className="creator-activity-value">{nextLevelName ?? levelName ?? '—'}</strong>
        <div className="creator-activity-detail">
          {progress !== null ? <>
            <span>{progress}% completado</span>
            <span className="creator-activity-progress" role="progressbar" aria-label={`Avance a ${nextLevelName}`} aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
              <span style={{ width: `${progress}%` }} />
            </span>
          </> : levelName ? 'Has alcanzado el nivel más alto.' : 'Consultando tu avance…'}
        </div>
        <span className="creator-activity-action">{nextLevelName ? 'Cómo avanzar' : levelName ? 'Ver beneficios' : 'Ver metas'} <Icon name="fa-arrow-right" /></span>
      </Link>
    </nav>
  );
};

export default CreatorActivitySummary;
