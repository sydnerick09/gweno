/**
 * Gweno client data layer, five performance/UX patterns in one small module:
 *   1) Request deduplication: concurrent GETs to the same URL share one request
 *   2) Optimistic update:     patch cache/UI now, roll back if the request fails
 *   3) Streaming UI:          render sections as each request resolves (helpers)
 *   4) Stale-while-revalidate: show cached data instantly, refresh in background
 *   5) Smart polling:         poll only while the tab is visible; pause when hidden
 *
 * Written as a UMD module so it runs in the browser (window.Data) and can be
 * unit-tested in Node (module.exports). Depends only on global fetch.
 */
(function (root) {
  const inflight = new Map();   // url -> Promise            (dedup)
  const cache = new Map();      // url -> { data, ts }       (SWR store)

  const clone = (v) => {
    try { return typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)); }
    catch (_) { return v; }
  };

  async function rawGet(url) {
    const r = await root.fetch(url);
    let d = {}; try { d = await r.json(); } catch (_) {}
    return { ok: r.ok, status: r.status, data: d };
  }

  // 1) Request deduplication: while a GET to `url` is in flight, everyone shares it.
  function get(url) {
    if (inflight.has(url)) return inflight.get(url);
    const p = rawGet(url).finally(() => inflight.delete(url));
    inflight.set(url, p);
    return p;
  }

  // Cache helpers.
  function cached(url) { const h = cache.get(url); return h ? h.data : null; }
  function has(url) { return cache.has(url); }
  function setCache(url, data) { cache.set(url, { data, ts: Date.now() }); }
  function invalidate(url) { cache.delete(url); }
  function isFresh(url, maxAge) { const h = cache.get(url); return !!h && (Date.now() - h.ts) < maxAge; }

  // 4) Stale-while-revalidate: fire `onData` immediately with cached data (if any),
  //    then revalidate over the network and fire `onData` again with fresh data.
  //    `onData(data, meta)`, meta = { stale:true } for cache, { stale:false } for fresh,
  //    or { error } if there's nothing cached and the request fails.
  function swr(url, onData, opts) {
    const options = opts || {};
    const maxAge = options.maxAge == null ? 30000 : options.maxAge;
    const hit = cache.get(url);
    if (hit) onData(hit.data, { stale: true });
    // If cache is still fresh and caller allows it, skip the network round-trip.
    if (hit && isFresh(url, maxAge) && options.revalidateIfFresh === false) {
      return Promise.resolve({ ok: true, data: hit.data, fromCache: true });
    }
    return get(url).then((res) => {
      if (res.ok) { setCache(url, res.data); onData(res.data, { stale: false }); }
      else if (!hit) onData(null, { error: res });
      return res;
    }).catch((err) => {
      if (!hit) onData(null, { error: err });
      return { ok: false, error: err };
    });
  }

  // 2) Optimistic update: apply `patch(data)` to the cached value for `url` right
  //    away, run `request()`, and roll back to the previous cache on failure.
  //    `request` should resolve to { ok } (or throw) so we know whether to keep it.
  async function optimistic(url, patch, request, onApply) {
    const prev = cache.has(url) ? clone(cache.get(url).data) : undefined;
    if (prev !== undefined) {
      const next = patch(clone(prev));
      setCache(url, next);
      if (typeof onApply === 'function') onApply(next);
    }
    try {
      const res = await request();
      if (res && res.ok === false) throw new Error((res.data && res.data.error) || 'Request failed');
      return res;
    } catch (err) {
      if (prev !== undefined) { setCache(url, prev); if (typeof onApply === 'function') onApply(prev); }
      throw err;
    }
  }

  // 3) Streaming UI: kick off several requests at once and hand each result to its
  //    own renderer the moment it arrives (instead of awaiting them all together).
  //    sections = [{ url, render(res) }]. Returns a Promise resolved when all settle.
  function stream(sections) {
    return Promise.all(sections.map((s) =>
      get(s.url).then((res) => { try { s.render(res); } catch (_) {} }).catch(() => {})));
  }

  const hidden = () => (typeof document !== 'undefined' && document.hidden);

  // 5) Smart polling: run `fn` every `interval` ms, but only while the tab is
  //    visible; when the tab is hidden we pause, and we run once immediately on
  //    return to focus. Returns a stop() function.
  function poll(fn, interval) {
    const ms = interval || 15000;
    let timer = null, stopped = false, running = false;
    const run = async () => {
      if (stopped || running || hidden()) return;
      running = true;
      try { await fn(); } catch (_) {} finally { running = false; }
    };
    const schedule = () => { if (!stopped) { clearTimeout(timer); timer = setTimeout(tick, ms); } };
    const tick = async () => { await run(); schedule(); };
    const onVis = () => { if (!hidden()) { tick(); } };
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVis);
    schedule();
    return function stop() {
      stopped = true;
      clearTimeout(timer);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVis);
    };
  }

  const api = {
    get, swr, optimistic, stream, poll,
    cached, has, setCache, invalidate, isFresh,
    _inflight: inflight, _cache: cache,
  };
  root.Data = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
