// Countries offered at sign-up, with their international dialing code. The name
// shown comes from the browser (Intl.DisplayNames) in the site's language, so the
// five languages stay in sync without translating ~100 country names by hand.
// 'ZZ' is "Otro país": the person then types the full number with its + prefix.
export interface Country {
  code: string; // ISO 3166-1 alpha-2
  dial: string; // without the +
}

const LIST =
  // Latin America and the Caribbean
  'HN:504 GT:502 SV:503 NI:505 CR:506 PA:507 MX:52 CO:57 VE:58 EC:593 PE:51 BO:591 CL:56 AR:54 UY:598 PY:595 BR:55 ' +
  'DO:1 PR:1 CU:53 HT:509 JM:1 TT:1 BZ:501 GY:592 SR:597 ' +
  // North America
  'US:1 CA:1 ' +
  // Europe
  'ES:34 PT:351 FR:33 IT:39 DE:49 GB:44 IE:353 NL:31 BE:32 LU:352 CH:41 AT:43 AD:376 SE:46 NO:47 DK:45 FI:358 ' +
  'PL:48 CZ:420 HU:36 RO:40 GR:30 UA:380 RU:7 TR:90 ' +
  // Africa
  'GQ:240 AO:244 MZ:258 CV:238 MA:212 EG:20 ZA:27 NG:234 KE:254 SN:221 CI:225 CM:237 ' +
  // Asia and Oceania
  'AE:971 SA:966 IL:972 IN:91 CN:86 JP:81 KR:82 PH:63 ID:62 TH:66 VN:84 MY:60 SG:65 AU:61 NZ:64';

export const COUNTRIES: Country[] = LIST.split(' ').map((pair) => {
  const [code, dial] = pair.split(':');
  return { code, dial };
});

export const OTHER_COUNTRY = 'ZZ';

export const isCountryCode = (code: string | undefined | null): code is string =>
  !!code && (code === OTHER_COUNTRY || COUNTRIES.some((c) => c.code === code));

export const dialCode = (code: string): string => COUNTRIES.find((c) => c.code === code)?.dial ?? '';

// 🇭🇳 from 'HN' (regional indicator letters).
export const countryFlag = (code: string): string =>
  code === OTHER_COUNTRY || !/^[A-Z]{2}$/.test(code)
    ? '🌐'
    : String.fromCodePoint(...[...code].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));

const displayNames = new Map<string, Intl.DisplayNames | null>();
export const countryName = (code: string, language: string, otherLabel: string): string => {
  if (code === OTHER_COUNTRY) return otherLabel;
  if (!displayNames.has(language)) {
    try {
      displayNames.set(language, new Intl.DisplayNames([language], { type: 'region' }));
    } catch {
      displayNames.set(language, null);
    }
  }
  return displayNames.get(language)?.of(code) ?? code;
};

// The list sorted by name in the given language, "Otro país" last.
export const sortedCountries = (language: string, otherLabel: string) =>
  [...COUNTRIES]
    .map((c) => ({ ...c, name: countryName(c.code, language, otherLabel) }))
    .sort((a, b) => a.name.localeCompare(b.name, language))
    .concat({ code: OTHER_COUNTRY, dial: '', name: otherLabel });

// Time zone → country, for the zones of the countries above that share no region
// subtag with the browser language (es-ES is common all over Latin America).
const ZONES: Record<string, string> = {
  Tegucigalpa: 'HN', Guatemala: 'GT', El_Salvador: 'SV', Managua: 'NI', Costa_Rica: 'CR', Panama: 'PA',
  Mexico_City: 'MX', Cancun: 'MX', Merida: 'MX', Monterrey: 'MX', Matamoros: 'MX', Chihuahua: 'MX', Ciudad_Juarez: 'MX',
  Ojinaga: 'MX', Mazatlan: 'MX', Bahia_Banderas: 'MX', Hermosillo: 'MX', Tijuana: 'MX',
  Bogota: 'CO', Caracas: 'VE', Guayaquil: 'EC', Galapagos: 'EC', Lima: 'PE', La_Paz: 'BO', Santiago: 'CL', Punta_Arenas: 'CL',
  Easter: 'CL', Buenos_Aires: 'AR', Cordoba: 'AR', Montevideo: 'UY', Asuncion: 'PY', Sao_Paulo: 'BR', Bahia: 'BR',
  Fortaleza: 'BR', Recife: 'BR', Belem: 'BR', Manaus: 'BR', Cuiaba: 'BR', Campo_Grande: 'BR', Porto_Velho: 'BR',
  Rio_Branco: 'BR', Boa_Vista: 'BR', Maceio: 'BR', Araguaina: 'BR', Santarem: 'BR', Noronha: 'BR',
  Santo_Domingo: 'DO', Puerto_Rico: 'PR', Havana: 'CU', 'Port-au-Prince': 'HT', Jamaica: 'JM', Port_of_Spain: 'TT',
  Belize: 'BZ', Guyana: 'GY', Paramaribo: 'SR',
  New_York: 'US', Chicago: 'US', Denver: 'US', Los_Angeles: 'US', Phoenix: 'US', Anchorage: 'US', Honolulu: 'US',
  Detroit: 'US', Boise: 'US', Indianapolis: 'US',
  Toronto: 'CA', Vancouver: 'CA', Edmonton: 'CA', Winnipeg: 'CA', Halifax: 'CA', Regina: 'CA', St_Johns: 'CA',
  Madrid: 'ES', Canary: 'ES', Ceuta: 'ES', Lisbon: 'PT', Madeira: 'PT', Azores: 'PT', Paris: 'FR', Rome: 'IT',
  Berlin: 'DE', London: 'GB', Dublin: 'IE', Amsterdam: 'NL', Brussels: 'BE', Luxembourg: 'LU', Zurich: 'CH',
  Vienna: 'AT', Andorra: 'AD', Stockholm: 'SE', Oslo: 'NO', Copenhagen: 'DK', Helsinki: 'FI', Warsaw: 'PL',
  Prague: 'CZ', Budapest: 'HU', Bucharest: 'RO', Athens: 'GR', Kyiv: 'UA', Kiev: 'UA', Moscow: 'RU', Istanbul: 'TR',
  Malabo: 'GQ', Luanda: 'AO', Maputo: 'MZ', Cape_Verde: 'CV', Casablanca: 'MA', Cairo: 'EG', Johannesburg: 'ZA',
  Lagos: 'NG', Nairobi: 'KE', Dakar: 'SN', Abidjan: 'CI', Douala: 'CM',
  Dubai: 'AE', Riyadh: 'SA', Jerusalem: 'IL', Tel_Aviv: 'IL', Kolkata: 'IN', Calcutta: 'IN', Shanghai: 'CN', Tokyo: 'JP',
  Seoul: 'KR', Manila: 'PH', Jakarta: 'ID', Bangkok: 'TH', Ho_Chi_Minh: 'VN', Saigon: 'VN', Kuala_Lumpur: 'MY',
  Singapore: 'SG', Sydney: 'AU', Melbourne: 'AU', Brisbane: 'AU', Perth: 'AU', Adelaide: 'AU', Auckland: 'NZ',
};

// Best guess of where the visitor is, to pre-select the country: the time zone
// first, then the region of a browser language. '' when nothing matches.
export const detectCountry = (): string => {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    const city = zone.split('/').pop() ?? '';
    const byZone = zone.startsWith('America/Argentina/') ? 'AR' : ZONES[city];
    if (byZone) return byZone;
  } catch {
    // ignore
  }
  const langs = typeof navigator !== 'undefined' ? navigator.languages ?? [navigator.language] : [];
  for (const lang of langs) {
    const region = (lang || '').split('-')[1]?.toUpperCase();
    if (region && COUNTRIES.some((c) => c.code === region)) return region;
  }
  return '';
};

// A phone number in international format (+50499998888), or an error key.
// Empty input is fine: the phone is optional. Spaces, dashes and a leading 0
// (national trunk prefix) are dropped; "+…" or "00…" is taken as already complete.
export const normalizePhone = (country: string, input: string): { phone: string } | { error: 'phone.invalid' | 'phone.needsPrefix' } => {
  const raw = input.trim();
  if (!raw) return { phone: '' };
  if (/[^\d\s().+-]/.test(raw)) return { error: 'phone.invalid' };
  const digits = raw.replace(/\D/g, '');
  let full: string;
  if (raw.startsWith('+') || raw.startsWith('00')) {
    full = raw.startsWith('00') ? digits.slice(2) : digits;
  } else {
    const dial = dialCode(country);
    if (!dial) return { error: 'phone.needsPrefix' };
    full = dial + digits.replace(/^0+/, '');
  }
  // E.164: at most 15 digits, and no country has numbers shorter than ~7 digits.
  if (!/^[1-9]\d{7,14}$/.test(full)) return { error: 'phone.invalid' };
  return { phone: `+${full}` };
};

// What goes back in the phone box for a saved number: without the country code
// when it matches the country, the whole +… number otherwise.
export const nationalPart = (country: string, phone: string | undefined): string => {
  if (!phone) return '';
  const dial = dialCode(country);
  return dial && phone.startsWith(`+${dial}`) ? phone.slice(dial.length + 1) : phone;
};

// Same rule as the database check on profiles.phone.
export const isValidPhone = (phone: string) => /^\+[1-9]\d{7,14}$/.test(phone);

// Countries of the demo creators (test mode), so Explore's country filter and the
// Top by country have something to show. The database function creator_countries()
// returns the same values.
export const DEMO_CREATOR_COUNTRIES: Record<string, string> = {
  '1': 'CO', '2': 'MX', '3': 'AR', '4': 'ES', '5': 'HN', '6': 'MX', '7': 'CO', '8': 'HN', '9': 'ES',
};
