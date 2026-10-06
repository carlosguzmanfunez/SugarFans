import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, prefersReducedMotion } from "./landingBits";
import Register from "../../pages/Register";

// Sign-up entrance for visitors: a short film (made with HyperFrames) that presents
// Fans Reserve as a whole. It opens the sign-up page (JoinPage) that visitors get at "/".
// Desktop: headline and the 16:9 film on the left, the sign-up form itself on the right
// (no extra click to reach /register).
// Phone: only the vertical 9:16 film, large, with the sign-up button under it.
const PHONE = "(max-width: 760px)";
const isPhone = () =>
  typeof window !== "undefined" && window.matchMedia(PHONE).matches;
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

const PresentationCover: React.FC = () => {
  const video = useRef<HTMLVideoElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  const [phone, setPhone] = useState(isPhone);

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
    if (prefersReducedMotion()) v.pause();
    return () => cancelAnimationFrame(raf);
  }, [phone]);

  const toggle = () => {
    const v = video.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  };

  return (
    <section className="pcover" aria-labelledby="pcover-title">
      <div className="wrap pcover-in">
        <div className="pc-main">
          <h2 id="pcover-title">
            Deja de comentar.{" "}
            <em>Empieza a hablar con los creadores de contenido que sigues.</em>
          </h2>
          <div className="pc-row">
            <p className="pc-lead">
              Pregúntales en su Live para suscriptores o habla cara a cara en
              una videollamada 1:1. Todo dentro de Fans Reserve.
            </p>
            <div className="pc-ctas">
              <Link to="/register" className="v-btn v-pri">
                Crear cuenta gratis <ArrowRight />
              </Link>
            </div>
          </div>

          <div className="pc-stage">
            <div className="pc-screen">
              <video
                ref={video}
                key={phone ? "v" : "h"}
                src={
                  phone
                    ? "/presentacion/fans-reserve-presentacion-vertical.mp4"
                    : "/presentacion/fans-reserve-presentacion.mp4"
                }
                poster={
                  phone
                    ? "/presentacion/poster-vertical.jpg"
                    : "/presentacion/poster.jpg"
                }
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
