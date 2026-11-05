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
    src: `/presentacion/fans-reserve-presentacion${shape}${suffix}.mp4?v=11`,
    poster: `/presentacion/poster${shape}${suffix}.jpg?v=10`,
  };
};
// Names come from the translations (cover.c.<key>), so the ribbon follows the language.
const COMMUNITIES = [
  { key: "people", photo: "valentina", c: "#ff9cc0" },
  { key: "fitness", photo: "diego", c: "#6ee7b7" },
  { key: "cooking", photo: "camila", c: "#fdba74" },
  { key: "music", photo: "andres", c: "#c4b5fd" },
  { key: "gaming", photo: "mateo", c: "#93c5fd" },
  { key: "art", photo: "sofia", c: "#f2d792" },
  { key: "beauty", photo: "isabela", c: "#fca5a5" },
  { key: "lifestyle", photo: "mariana", c: "#bef264" },
  { key: "education", photo: "daniel", c: "#67e8f9" },
];

const PresentationCover: React.FC = () => {
  const video = useRef<HTMLVideoElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  const [phone, setPhone] = useState(isPhone);
  const { language, t } = useLanguage();
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
    if (prefersReducedMotion()) v.pause();
    return () => cancelAnimationFrame(raf);
  }, [phone, hasFilm]);

  const toggle = () => {
    const v = video.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  };

  return (
    <section
      className={hasFilm ? "pcover" : "pcover pc-nofilm"}
      aria-labelledby="pcover-title"
    >
      <div className="wrap pcover-in">
        <div className="pc-main">
          <h2 id="pcover-title">
            {t("cover.title")} <em>{t("cover.titleEm")}</em>
          </h2>
          <div className="pc-row">
            <p className="pc-lead">
              {t("cover.lead")}
            </p>
            <div className="pc-ctas">
              <Link to="/register" className="v-btn v-pri">
                {t("cover.cta")} <ArrowRight />
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
                  aria-label={t("cover.videoLabel")}
                />
                <button
                  type="button"
                  className="pc-pp"
                  onClick={toggle}
                  aria-label={paused ? t("cover.play") : t("cover.pause")}
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
            {t("cover.cta")} <ArrowRight />
          </Link>
          <Link to="/login" className="pc-login">
            {t("cover.haveAccount")} <b>{t("cover.login")}</b>
          </Link>
        </div>

        <div className="pc-ribbon" aria-label={t("cover.communities")}>
          {COMMUNITIES.map((x) => (
            <span key={x.key} style={{ ["--c" as string]: x.c }}>
              <img
                src={`/creators/photos/${x.photo}.jpg`}
                alt=""
                loading="lazy"
              />
              {t(`cover.c.${x.key}`)}
            </span>
          ))}
        </div>
        <p className="pc-trust">
          <span>
            <b>{t("cover.trustVerified")}</b>
          </span>
          <span>
            <b>{t("cover.trustSecure")}</b> {t("cover.trustSecureTail")}
          </span>
          <span>
            {t("cover.trustPayIn")} <b>{t("cover.trustCredits")}</b>
          </span>
          <span>
            {t("cover.trustAccept")} <b>{t("cover.trustReserve")}</b>
          </span>
        </p>
      </div>
    </section>
  );
};

export default PresentationCover;
