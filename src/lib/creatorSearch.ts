export const searchText = (value: string) => value.trim().normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();

export const matchesCreatorSearch = (creator: { name: string; username?: string }, query: string) => {
  const value = searchText(query);
  const handleOnly = value.startsWith('@');
  const term = handleOnly ? value.slice(1) : value;
  if (!term) return true;
  const handle = searchText(creator.username ?? '').replace(/^@/, '');
  return handle.includes(term) || (!handleOnly && searchText(creator.name).includes(term));
};
