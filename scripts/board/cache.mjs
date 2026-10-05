/** Cache identity is independent of shard count and package-list order. */
export function mergeCachedResults(shards) {
  const cache = new Map();
  for (const shard of shards) {
    for (const [name, result] of Object.entries(shard.results ?? {})) {
      const old = cache.get(name);
      if (!old || (result.probeSchema ?? 0) > (old.probeSchema ?? 0)
        || (result.probeSchema === old.probeSchema && (result.probedAt ?? '') > (old.probedAt ?? ''))) cache.set(name, result);
    }
  }
  return cache;
}

/** A shard retains only its current subjects and exact cached versions. */
export function cachedShard(packages, cache, schema) {
  return Object.fromEntries(packages.filter(p => cache.get(p.name)?.version === p.version
    && cache.get(p.name)?.probeSchema === schema).map(p => [p.name, cache.get(p.name)]));
}
