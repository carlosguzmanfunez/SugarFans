// Where to go after signing in. Only a path inside this site: "/x", never
// "//other.com", "/\other.com" or a full URL (an attacker could send people
// to a look-alike page from a crafted link).
export const safePath = (to: unknown): string | undefined => {
  if (typeof to !== 'string' || !to.startsWith('/')) return undefined;
  if (/^\/[\\/]/.test(to) || /[\\\u0000-\u001f]/.test(to)) return undefined;
  return to;
};
