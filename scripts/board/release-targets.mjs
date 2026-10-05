/** Diff every changed tag; only latest/next schedule a full board, once per version. */
export function releaseTargets(changes) {
  const boards = new Set();
  return changes.filter(m => m.from && m.to && m.from !== m.to).map(m => {
    const runBoard = ['latest', 'next'].includes(m.tag) && !boards.has(m.to);
    if (runBoard) boards.add(m.to);
    return { tag: m.tag, from: m.from, to: m.to, runBoard };
  });
}
