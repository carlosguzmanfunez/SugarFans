// Virtual currency: what fans buy in packs and spend on gifts.
//
// INTERNAL vs DISPLAY. The database and code still call it "Terrones" (the
// previous brand): table/column names, the migration
// 20260930000007_gifts_terrones.sql and the method label 'Terrones' that the
// send_gift RPC writes on gift transactions. Those stay as they are so no
// stored row changes. Everything the user reads comes from here, so renaming the
// currency later is a one-line change.
//
// "Créditos" is a neutral placeholder until the final name is chosen.

export const VIRTUAL_CURRENCY_ID = 'terrones'; // internal identifier, do not change

export const VIRTUAL_CURRENCY = {
  displayName: 'Créditos', // plural, as used in copy: "500 créditos"
  singular: 'Crédito',
  // Rendered with the coin artwork in public/brand/coin.png (CoinIcon).
  icon: '/brand/coin.png',
} as const;

export const VIRTUAL_CURRENCY_DISPLAY_NAME = VIRTUAL_CURRENCY.displayName;

// Lower-case plural for running text: "Tienes 500 créditos".
export const currencyWord = VIRTUAL_CURRENCY.displayName.toLowerCase();

// Method label stored on gift transactions by the database ('Terrones').
const LEGACY_METHOD_LABELS = ['Terrones'];
export const displayMethodLabel = (label: string) => (LEGACY_METHOD_LABELS.includes(label) ? VIRTUAL_CURRENCY.displayName : label);
