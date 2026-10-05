import { setTimeout as delay } from 'node:timers/promises';

/** Registry reads share a rate-limit cooldown; permanent errors fail promptly. */
export function createRegistryReader({ fetchImpl = fetch, wait = delay, now = Date.now, retries = 6 } = {}) {
  let retryNotBefore = 0;
  return async function getJson(url, headers = {}) {
    for (let attempt = 0; attempt < retries; attempt++) {
      const cooldown = retryNotBefore - now();
      if (cooldown > 0) await wait(cooldown);
      let response;
      try {
        response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(30_000) });
      } catch (error) {
        if (attempt + 1 === retries) throw error;
        await wait(Math.min(120_000, 15_000 * 2 ** attempt));
        continue;
      }
      if (response.status === 404) { await response.body?.cancel(); return null; }
      if (response.ok) return response.json();
      const status = response.status;
      const retryAfter = response.headers.get('retry-after');
      await response.body?.cancel();
      if ((status !== 429 && status < 500) || attempt + 1 === retries) throw new Error(`HTTP ${status}`);
      const seconds = retryAfter === null ? NaN : Number(retryAfter);
      const serverDelay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter ?? '') - now();
      const backoff = Math.max(15_000, Number.isFinite(serverDelay) ? serverDelay : 15_000 * 2 ** attempt);
      retryNotBefore = Math.max(retryNotBefore, now() + backoff);
    }
    throw new Error('registry retry budget exhausted');
  };
}
