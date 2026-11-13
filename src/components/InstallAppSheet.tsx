import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { backend } from '../lib/backend';
import { appInstalledHere, isInstalledApp, useInstallApp } from '../lib/install';
import { readJSON, writeJSON } from '../lib/storage';
import BrandLogo from './BrandLogo';
import Icon from './Icon';

const KEY = 'installSheet';
// Until the app is installed the sheet keeps coming back on the phone's browser
// (Carlos 2026-11-13): "Ahora no" hides it for the rest of the day, "Listo, ya la
// instalé" for a few days (if they keep using the browser, it wasn't installed).
// Once the app is known to be installed, never again: on this phone and, through
// the account (user.appInstalled), on any other.
const DONE_SNOOZE_MS = 3 * 24 * 60 * 60 * 1000;
const endOfToday = () => {
  const d = new Date();
  d.setHours(24, 0, 0, 0);
  return d.getTime();
};
type Saved = { installed?: boolean; until?: number };

const isIOS = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isPhone = () => window.matchMedia?.('(pointer: coarse)').matches && window.innerWidth < 1024;

// Pages where a sheet would get in the way: sign-up, the creator's first visit to
// the panel (identity check comes first), payments and video rooms.
const SKIP = /^\/(login|register|age-verification|auth|reset-password|forgot-password|live|en-vivo|evento)\b/;

// "Instala Fans Reserve": once signed in on a phone, a bottom sheet asks to add the
// app to the home screen (its own icon, alerts under its name). Android/Chrome gets
// the real install button; iPhone gets the two taps Safari needs.
const InstallAppSheet: React.FC = () => {
  const { user, isAuthenticated } = useAuth();
  const { t } = useLanguage();
  const { pathname, search } = useLocation();
  const { canInstall, install, installedNow } = useInstallApp();
  const [open, setOpen] = useState(false);
  const [ios] = useState(isIOS);
  const [installed, setInstalled] = useState(() => readJSON<Saved>(KEY, {}).installed === true);
  const known = installed || user?.appInstalled === true;

  // Learn that the app is installed (opened from its icon, or Chrome says so) and
  // keep it on the account, so the sheet stops everywhere.
  useEffect(() => {
    if (!isAuthenticated || !user) return;
    let alive = true;
    void appInstalledHere().then((yes) => {
      if (!alive || !yes) return;
      writeJSON(KEY, { installed: true });
      setInstalled(true);
      setOpen(false);
      if (!user.appInstalled) void backend.markAppInstalled?.();
    });
    return () => {
      alive = false;
    };
  }, [isAuthenticated, user, installedNow]);

  const eligible =
    isAuthenticated && !!user && !known && !isInstalledApp() && isPhone() && !SKIP.test(pathname) && !new URLSearchParams(search).has('bienvenida');

  useEffect(() => {
    if (!eligible || open) return;
    const saved = readJSON<Saved>(KEY, {});
    if (saved.until && saved.until > Date.now()) return;
    // A moment after the page settles, so it doesn't land on top of a redirect.
    const timer = setTimeout(() => setOpen(true), 1800);
    return () => clearTimeout(timer);
  }, [eligible, open]);

  if (!open || !eligible) return null;

  const later = () => {
    writeJSON(KEY, { until: endOfToday() });
    setOpen(false);
  };
  const done = () => {
    writeJSON(KEY, { until: Date.now() + DONE_SNOOZE_MS });
    setOpen(false);
  };
  const installNow = async () => {
    if (await install()) {
      writeJSON(KEY, { installed: true });
      setInstalled(true);
      setOpen(false);
      void backend.markAppInstalled?.();
    }
  };

  const step = (n: number, text: React.ReactNode) => (
    <li className="flex items-start gap-3">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-50 text-sm font-bold text-brand-700">{n}</span>
      <p className="pt-0.5 text-sm text-ink/80">{text}</p>
    </li>
  );

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-night-950/40 backdrop-blur-[2px]" data-testid="install-sheet" data-platform={ios ? 'ios' : canInstall ? 'android' : 'menu'}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="install-sheet-title"
        className="w-full max-w-md rounded-t-3xl bg-white p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-[var(--shadow-lift)]"
      >
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-night-950">
            <BrandLogo size="sm" tone="dark" to={null} className="[&>svg:last-child]:hidden" />
          </span>
          <div className="min-w-0">
            <p id="install-sheet-title" className="text-lg font-bold text-ink">{t('installApp.title')}</p>
            <p className="text-sm text-ink/70">{t('installApp.why')}</p>
          </div>
        </div>

        {ios ? (
          <ol className="mt-4 space-y-3" data-testid="install-steps-ios">
            {step(1, <>{t('installApp.ios.1')} <span className="inline-flex translate-y-0.5 items-center rounded-md border border-line px-1.5 text-brand-700"><i aria-hidden="true" className="fas fa-arrow-up-from-bracket text-xs"></i></span></>)}
            {step(2, t('installApp.ios.2'))}
            {step(3, t('installApp.ios.3'))}
          </ol>
        ) : !canInstall ? (
          <ol className="mt-4 space-y-3" data-testid="install-steps-menu">
            {step(1, <>{t('installApp.menu.1')} <span className="inline-flex translate-y-0.5 items-center rounded-md border border-line px-1.5 text-brand-700"><i aria-hidden="true" className="fas fa-ellipsis-vertical text-xs"></i></span></>)}
            {step(2, t('installApp.menu.2'))}
          </ol>
        ) : null}

        <div className="mt-5 flex flex-col gap-2">
          {!ios && canInstall ? (
            <button type="button" onClick={installNow} data-testid="install-now" className="btn btn-md btn-primary w-full justify-center">
              <i aria-hidden="true" className="fas fa-download mr-1.5"></i>{t('installApp.button')}
            </button>
          ) : (
            <button type="button" onClick={done} data-testid="install-done" className="btn btn-md btn-primary w-full justify-center">
              {t('installApp.done')}
            </button>
          )}
          <button type="button" onClick={later} data-testid="install-later" className="h-10 text-sm font-medium text-ink/60 hover:text-ink">
            {t('installApp.later')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default InstallAppSheet;
