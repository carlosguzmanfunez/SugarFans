// Phones: pressing "Buscar"/Enter on the keyboard in any search box closes the keyboard so
// the results are visible (Carlos 2026-11-13: it stayed open covering the list). The search
// itself already runs while typing (or on the form submit), so only the focus is dropped.
if (typeof document !== 'undefined') {
  document.addEventListener('keydown', (e) => {
    const el = e.target;
    if (e.key === 'Enter' && !e.isComposing && el instanceof HTMLInputElement && el.type === 'search') {
      // After the form's own submit handler (if any) has run.
      setTimeout(() => el.blur(), 0);
    }
  });
}
