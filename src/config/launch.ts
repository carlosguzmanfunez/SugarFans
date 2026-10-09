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

// Paths anyone can open while the gate is up.
export const PUBLIC_PATHS = ['/legal', '/policies'];
