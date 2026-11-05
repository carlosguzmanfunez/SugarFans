import React from 'react';

const options = [
  {
    key: 'subscription',
    anchor: 'suscribirse',
    title: 'Comparte contenido exclusivo',
    description: 'Invita a tus seguidores a suscribirse para ver tus fotos, videos y publicaciones exclusivas.',
  },
  {
    key: 'reserve',
    anchor: 'reserve',
    title: 'Ofrece experiencias Reserve',
    description: 'Publica videollamadas, clases o eventos y comparte tu perfil en tus redes para que reserven contigo.',
  },
  {
    key: 'proposal',
    title: 'Acepta propuestas de tus fans',
    description: 'Recibe sus ideas con fecha y presupuesto. Tú decides cuáles aceptar y acuerdas los detalles.',
  },
];

const CreatorMonetization: React.FC = () => (
  <section id="journey" className="cta-band creator-monetization" aria-labelledby="creator-monetization-title" data-testid="creator-monetization">
    <div id="creadores" className="wrap">
      <div className="creator-monetization-copy">
        <h2 id="creator-monetization-title">Trae a tu comunidad, sea cual sea tu contenido.</h2>
        <p>Sigue creando en tus redes. Aquí tienes tres formas de generar ingresos con tu comunidad.</p>
      </div>
      <div className="creator-income-options">
        {options.map((option) => (
          <article key={option.key} id={option.anchor} className={`creator-income-card creator-income-${option.key}`} aria-labelledby={`creator-income-${option.key}`}>
            <h3 id={`creator-income-${option.key}`}>{option.title}</h3>
            <p>{option.description}</p>
          </article>
        ))}
      </div>
    </div>
  </section>
);

export default CreatorMonetization;
