/** Search pages may overlap; classify and display each package name only once. */
export function uniquePackages(rows) {
  const byName = new Map();
  for (const row of rows) {
    const previous = byName.get(row.name);
    if (!previous) { byName.set(row.name, row); continue; }
    const newer = (Date.parse(row.modified ?? '') || 0) > (Date.parse(previous.modified ?? '') || 0);
    const selected = newer ? row : previous;
    byName.set(row.name, { ...selected, ambiguous: previous.ambiguous || row.ambiguous || row.version !== previous.version });
  }
  return [...byName.values()];
}
