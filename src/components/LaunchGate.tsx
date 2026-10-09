import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import BrandLogo from './BrandLogo';
import { readJSON, writeJSON } from '../lib/storage';
import { ACCESS_CODE_SHA256, GATED_HOSTS, LAUNCHED, PUBLIC_PATHS } from '../config/launch';

const ACCESS_KEY = 'previewAccess';
// Lets the e2e suite exercise the gate away from fansreserve.com, with a test code
// that never works on the real domain.
const FORCE_KEY = 'forceLaunchGate';
const TEST_CODE = 'prueba-e2e';

const sha256 = async (text: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
};

const gatedHere = () => !LAUNCHED && (GATED_HOSTS.includes(window.location.hostname) || readJSON(FORCE_KEY, false));

// Until launch, the public sees "Muy pronto"; a device that opened the private link sees the site.
const LaunchGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const [gated] = useState(gatedHere);
  const [allowed, setAllowed] = useState(() => !gated || readJSON(ACCESS_KEY, false));
  const code = new URLSearchParams(location.search).get('acceso');
  const [checking, setChecking] = useState(gated && !allowed && !!code);

  useEffect(() => {
    if (!gated || !code) return;
    let alive = true;
    sha256(code.trim())
      .then((hash) => {
        if (!alive) return;
        const testCode = !GATED_HOSTS.includes(window.location.hostname) && code.trim() === TEST_CODE;
        if (hash === ACCESS_CODE_SHA256 || testCode) {
          writeJSON(ACCESS_KEY, true);
          setAllowed(true);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!alive) return;
        setChecking(false);
        // The code doesn't stay in the address bar (or in screenshots of it).
        const params = new URLSearchParams(location.search);
        params.delete('acceso');
        const search = params.toString();
        navigate({ pathname: location.pathname, search: search ? `?${search}` : '', hash: location.hash }, { replace: true });
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, gated]);

  // Keep search engines out while the gate is up.
  useEffect(() => {
    if (!gated || allowed) return;
    const meta = document.querySelector('meta[name="robots"]');
    const previous = meta?.getAttribute('content');
    meta?.setAttribute('content', 'noindex, nofollow');
    return () => {
      if (previous) meta?.setAttribute('content', previous);
    };
  }, [gated, allowed]);

  if (!gated || allowed || PUBLIC_PATHS.some((p) => location.pathname.startsWith(p))) return <>{children}</>;
  if (checking) return <div className="min-h-screen bg-night-950" />;

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-night-950 px-6 text-center text-white" data-testid="coming-soon">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -left-32 -top-40 h-[520px] w-[520px] rounded-full bg-[radial-gradient(closest-side,rgba(200,27,99,0.35),transparent)]" />
        <div className="absolute -bottom-48 -right-32 h-[520px] w-[520px] rounded-full bg-[radial-gradient(closest-side,rgba(109,60,230,0.3),transparent)]" />
      </div>
      <div className="relative z-10 flex max-w-xl flex-col items-center">
        <BrandLogo tone="dark" to={null} />
        <p className="mt-10 text-sm font-semibold uppercase tracking-[0.2em] text-gold-200">Muy pronto</p>
        <h1 className="mt-4 text-display-md text-white">Conecta más allá del feed.</h1>
        <p className="mt-4 text-lg text-white/75">
          Estamos preparando todo para que empieces a hablar con los creadores de contenido que sigues. Vuelve pronto.
        </p>
      </div>
    </main>
  );
};

export default LaunchGate;
