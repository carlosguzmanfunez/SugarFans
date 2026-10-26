import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, prefersReducedMotion } from "./landingBits";
import Register from "../../pages/Register";
import { useLanguage, type Language } from "../../context/LanguageContext";

// Sign-up entrance for visitors: a short film (made with HyperFrames) that presents
// Fans Reserve as a whole. It opens the sign-up page (JoinPage) that visitors get at "/".
// Desktop: headline and the 16:9 film on the left, the sign-up form itself on the right
// (no extra click to reach /register).
// Phone: only the vertical 9:16 film, large, with the sign-up button under it.
const PHONE = "(max-width: 760px)";
const isPhone = () =>
  typeof window !== "undefined" && window.matchMedia(PHONE).matches;
// The film has its on-screen text in the visitor's language: one render per language
// (Spanish keeps the original file names). A language without its own render hides the
// film instead of showing it in another language.
const FILM_LANGS: Language[] = ["es", "en", "pt", "fr", "it"];
const filmFiles = (lang: Language, phone: boolean) => {
  const suffix = lang === "es" ? "" : `-${lang}`;
  const shape = phone ? "-vertical" : "";
  return {
    src: `/presentacion/fans-reserve-presentacion${shape}${suffix}.mp4?v=10`,
    poster: `/presentacion/poster${shape}${suffix}.jpg?v=10`,
  };
};
const COMMUNITIES = [
  { name: "Tu gente", photo: "valentina", c: "#ff9cc0" },
  { name: "Fitness", photo: "diego", c: "#6ee7b7" },
  { name: "Cocina", photo: "camila", c: "#fdba74" },
  { name: "Música", photo: "andres", c: "#c4b5fd" },
  { name: "Gaming", photo: "mateo", c: "#93c5fd" },
  { name: "Arte", photo: "sofia", c: "#f2d792" },
  { name: "Belleza", photo: "isabela", c: "#fca5a5" },
  { name: "Lifestyle", photo: "mariana", c: "#bef264" },
  { name: "Educación", photo: "daniel", c: "#67e8f9" },
];

// variant "film" (home V3): a calm chapter lower on the page. The film waits for a
// tap instead of playing on its own; the sign-up form stays beside it on desktop.
const PresentationCover: React.FC<{ variant?: "cover" | "film" }> = ({ variant = "cover" }) => {
  const video = useRef<HTMLVideoElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const filmOnly = variant === "film";
  const [paused, setPaused] = useState(filmOnly);
  const [phone, setPhone] = useState(isPhone);
  const { language } = useLanguage();
  const hasFilm = FILM_LANGS.includes(language);
  const film = filmFiles(language, phone);

  useEffect(() => {
    const mq = window.matchMedia(PHONE);
    const on = () => setPhone(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    let raf = 0;
    const tick = () => {
      if (v.duration && bar.current)
        bar.current.style.transform = `scaleX(${v.currentTime / v.duration})`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    if (prefersReducedMotion() || filmOnly) v.pause();
    return () => cancelAnimationFrame(raf);
  }, [phone, hasFilm, filmOnly]);

  const toggle = () => {
    const v = video.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  };

  if (filmOnly)
    return (
      <div className="pcover v3-filmch" data-testid="presentation-film">
        <div className="v3-wrap v3-filmch-in">
          <div className="v3-filmch-main">
            <p className="v3-eyebrow">Presentación</p>
            <h2 className="v3-h2 mt-3">
              Mira cómo funciona <em>en un minuto.</em>
            </h2>
            <p className="v3-lead mt-4 max-w-md">
              Sigue a tus creadores, suscríbete a su contenido exclusivo o reserva una sesión en vivo con ellos. Todo dentro de Fans Reserve.
            </p>
            {hasFilm && (
              <div className="v3-filmch-screen">
                <video
                  ref={video}
                  key={film.src}
                  src={film.src}
                  poster={film.poster}
                  muted
                  loop
                  playsInline
                  preload="none"
                  onPlay={() => setPaused(false)}
                  onPause={() => setPaused(true)}
                  aria-label="Presentación de Fans Reserve: comunidades, cómo funciona y Reserve"
                />
                <button type="button" className={paused ? "v3-play" : "v3-play is-on"} onClick={toggle} aria-label={paused ? "Reproducir la presentación" : "Pausar"}>
                  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    {paused ? <path d="M8 5v14l11-7z" /> : <path d="M7 5h4v14H7zM13 5h4v14h-4z" />}
                  </svg>
                </button>
                <div className="pc-bar" ref={bar} />
              </div>
            )}
          </div>
          {!phone && (
            <div className="pc-signup v3-filmch-form">
              <Register embedded />
            </div>
          )}
        </div>
      </div>
    );

  return (
    <section
      className={hasFilm ? "pcover" : "pcover pc-nofilm"}
      aria-labelledby="pcover-title"
    >
      <div className="wrap pcover-in">
        <div className="pc-main">
          <h2 id="pcover-title">
            Conecta más allá del feed.{" "}
            <em>Empieza a hablar con los creadores de contenido que sigues.</em>
          </h2>
          <div className="pc-row">
            <p className="pc-lead">
              Suscríbete a su contenido exclusivo o habla cara a cara en
              una videollamada 1:1. Todo dentro de Fans Reserve.
            </p>
            <div className="pc-ctas">
              <Link to="/register" className="v-btn v-pri">
                Crear cuenta gratis <ArrowRight />
              </Link>
            </div>
          </div>

          {hasFilm && (
            <div className="pc-stage">
              <div className="pc-screen">
                <video
                  ref={video}
                  key={film.src}
                  src={film.src}
                  poster={film.poster}
                  autoPlay
                  muted
                  loop
                  playsInline
                  preload="metadata"
                  onPlay={() => setPaused(false)}
                  onPause={() => setPaused(true)}
                  aria-label="Presentación de Fans Reserve: comunidades, cómo funciona y Reserve"
                />
                <button
                  type="button"
                  className="pc-pp"
                  onClick={toggle}
                  aria-label={paused ? "Reproducir" : "Pausar"}
                >
                  <svg
                    className="ico"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    {paused ? (
                      <path d="M8 5v14l11-7z" />
                    ) : (
                      <path d="M7 5h4v14H7zM13 5h4v14h-4z" />
                    )}
                  </svg>
                </button>
                <div className="pc-bar" ref={bar} />
              </div>
            </div>
          )}
        </div>

        {!phone && (
          <div className="pc-signup">
            <Register embedded />
          </div>
        )}

        <div className="pc-join">
          <Link to="/register" className="v-btn v-pri">
            Crear cuenta gratis <ArrowRight />
          </Link>
          <Link to="/login" className="pc-login">
            ¿Ya tienes cuenta? <b>Inicia sesión</b>
          </Link>
        </div>

        <div className="pc-ribbon" aria-label="Comunidades">
          {COMMUNITIES.map((x) => (
            <span key={x.name} style={{ ["--c" as string]: x.c }}>
              <img
                src={`/creators/photos/${x.photo}.jpg`}
                alt=""
                loading="lazy"
              />
              {x.name}
            </span>
          ))}
        </div>
        <p className="pc-trust">
          <span>
            <b>Perfiles verificados</b>
          </span>
          <span>
            <b>Pagos seguros</b> con PayPal
          </span>
          <span>
            Paga en <b>Créditos</b>
          </span>
          <span>
            El creador acepta, <b>luego pagas</b>
          </span>
        </p>
      </div>
    </section>
  );
};

export default PresentationCover;
