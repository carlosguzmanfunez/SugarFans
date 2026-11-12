// PRE-LAUNCH GATE. Until the official launch, fansreserve.com (and www) shows a
// "Muy pronto" page to the public. Whoever opens the private link
// https://fansreserve.com/?acceso=<code> once sees the full site on that device
// from then on. PR previews and localhost stay open for testing.
//
// To launch: set LAUNCHED to true (or VITE_LAUNCHED=true in Vercel, then redeploy).
// The legal pages stay public (payment providers and Google sign-in link to them),
// and /api is untouched (PayPal webhooks keep working).
export const LAUNCHED: boolean = false || import.meta.env.VITE_LAUNCHED === 'true';

export const GATED_HOSTS = ['fansreserve.com', 'www.fansreserve.com'];

// SHA-256 of the access code: the code itself is not in the repository.
// To change it, put the hash of a new code here; old links stop working.
export const ACCESS_CODE_SHA256 = 'd1ceab3226896484c00d03baa6fe8d5e629b903423d5374de834434811fcbdbb';

// Personal access codes for the first testers (one per person, so one can be
// switched off by deleting its line without touching the team's link).
export const TESTER_CODE_SHA256: Record<string, string> = {
  hermano: '13fa6ba9ccdc526d4d8431b6cca27a7aad27d38bbd53a163bbb260c95a1f0af4',
  amigo: '67277ffd0f936857245de3b52b693c6a334754060a650d9d823a39f84f17e0b1',
};
export const ACCESS_HASHES = [ACCESS_CODE_SHA256, ...Object.values(TESTER_CODE_SHA256)];

// Paths anyone can open while the gate is up. /reset-password: the link in the
// "recuperar contraseña" email works on any device, not only on one that opened
// the private link (the page needs the one-time token from that email). /c/: the
// personal invite links we send to creators (they can say "quiero participar" or
// unsubscribe before the launch).
export const PUBLIC_PATHS = ['/legal', '/policies', '/reset-password', '/c/'];
