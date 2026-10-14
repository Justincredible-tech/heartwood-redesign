/* Authoritative content photos. Local responsive pictures are initial/offline
   fallbacks; original URLs retain the publisher's browser-cache validators.
   Included in both desktop and phone bundles; no idle polling or DOM observer. */
var HeartwoodPhotos = (() => {
  const INTERVAL = 6 * 60 * 60 * 1000;
  const RETRY = 10 * 60 * 1000;
  const loopback = url => ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);

  // A readable Fetch body (same-origin publisher deployments, and any future
  // combination that exposes one) is streamed to completion and discarded
  // BEFORE the native image is created: the browser never has a half-consumed
  // body left for a late abort, and nothing larger than one chunk is held.
  // Opaque responses have body:null and skip this. The attempt signal bounds
  // the reading; the lock is released on completion and on the error path.
  async function drainBody(response, signal) {
    const body = response && response.body;
    if (!body || typeof body.getReader !== 'function') return;
    const reader = body.getReader();
    try {
      for (;;) {
        const {done} = await reader.read();
        if (done || signal.aborted) break;
      }
    } finally {
      try { reader.releaseLock(); }
      catch (_) { /* an errored stream can refuse the lock; the abort path owns the failure */ }
    }
  }

  function create(options = {}) {
    const win = options.window || window, doc = win.document;
    const now = options.now || Date.now, timeout = options.timeoutMs || 8000;
    const page = new URL(win.location.href);
    // Owned tests supply real loopback HTTP fixtures, preserving browser caches.
    // This dependency is ignored on public origins; it never authorizes egress.
    const resolve = loopback(page) && typeof win.heartwoodPhotoSource === 'function'
      ? win.heartwoodPhotoSource : url => url;
    const jobs = new Map(), entries = new Set(), known = new WeakMap(), attempts = new Set();
    let closed = false;

    function photoURL(value) {
      try {
        const url = new URL(value);
        if (url.username || url.password || url.hash) return null;
        if (!(url.origin === 'https://heartwood.org' || loopback(url) && /^https?:$/.test(url.protocol))) return null;
        return url.href;
      } catch (_) { return null; }
    }

    function inView(el) {
      if (!el.getClientRects().length) return false;
      if (!el.getBoundingClientRect) return true;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.bottom >= -160 && rect.top <= win.innerHeight + 160;
    }

    function prune() {
      for (const entry of entries) {
        if (!entry.el.isConnected || photoURL(entry.el.getAttribute('data-live-photo')) !== entry.key) {
          observer && observer.unobserve(entry.el);
          entries.delete(entry); known.delete(entry.el);
        }
      }
    }

    function image(url, signal) {
      const img = new win.Image();
      img.decoding = 'async';
      return new Promise((accept, reject) => {
        const clear = () => { img.onload = img.onerror = null; signal.removeEventListener('abort', abort); };
        const abort = () => { clear(); img.removeAttribute && img.removeAttribute('src'); reject(Error('Photo acquisition stopped')); };
        img.onload = async () => {
          try {
            if (!img.naturalWidth) throw Error('Empty photo');
            if (img.decode) await img.decode();
            if (signal.aborted) throw Error('Photo acquisition stopped');
            clear(); accept(img);
          } catch (error) { clear(); reject(error); }
        };
        img.onerror = () => { clear(); reject(Error('Photo did not load')); };
        signal.addEventListener('abort', abort, {once: true});
        if (signal.aborted) return abort();
        img.src = url;
      });
    }

    function install(entry, next) {
      const old = entry.el;
      if (closed || doc.hidden || !old.isConnected || photoURL(old.getAttribute('data-live-photo')) !== entry.key) return;
      // Preserve dimensions, alternate text and visual classes. No old srcset or
      // picture source may override the freshly decoded original image.
      for (const attr of [...old.attributes]) {
        if (!['src', 'srcset', 'sizes', 'loading', 'onerror', 'onload'].includes(attr.name)) next.setAttribute(attr.name, attr.value);
      }
      const picture = old.closest('picture');
      if (picture) picture.querySelectorAll('source').forEach(source => source.remove());
      observer && observer.unobserve(old);
      known.delete(old); old.replaceWith(next); entry.el = next; known.set(next, entry);
      observer && observer.observe(next);
    }

    async function acquire(job, revalidate) {
      const stop = new AbortController();
      attempts.add(stop);
      let timer;
      const expired = new Promise((_, reject) => {
        timer = win.setTimeout(() => { stop.abort(); reject(Error('Photo acquisition timed out')); }, timeout);
      });
      try {
        await Promise.race([ (async () => {
          if (revalidate) {
            // An opaque response has no readable status/hash. Native decode is
            // the success criterion; a HEAD cannot validate the local WebP.
            const response = await win.fetch(job.url, {mode: 'no-cors', credentials: 'include',
              cache: 'no-cache', redirect: 'follow', signal: stop.signal});
            await drainBody(response, stop.signal);
          }
          const ready = await image(job.url, stop.signal);
          if (closed || stop.signal.aborted) return;
          const targets = [...entries].filter(e => e.key === job.key && e.el.isConnected && e.visible && inView(e.el));
          for (let i = 0; i < targets.length; i++) {
            const next = i ? await image(job.url, stop.signal) : ready;
            install(targets[i], next);
          }
          if (revalidate) job.good = true;
        })(), expired ]);
      } catch (_) {
        // Leave the last displayed photo intact. Failures consume the cooldown;
        // repeated leaf opens, focus events and scrolls are not retry loops.
        job.good = false; job.lastAttempt = now();
      } finally {
        win.clearTimeout(timer); stop.abort(); attempts.delete(stop);
      }
    }

    function refresh(entry) {
      if (closed || doc.hidden || !entry.el.isConnected || !entry.visible || !inView(entry.el) || photoURL(entry.el.getAttribute('data-live-photo')) !== entry.key) return;
      const job = jobs.get(entry.key);
      if (!job || job.pending) return;
      const due = now() - job.lastAttempt >= (job.good ? INTERVAL : RETRY);
      if (!due && !job.good) return;
      // A newly inserted detail image can reuse the already validated cache.
      if (!due && entry.el.src === job.url) return;
      if (due) job.lastAttempt = now();
      job.pending = acquire(job, due).finally(() => {
        job.pending = null;
        // A detail sheet inserted after the acquisition snapshot must also
        // receive the validated image, using the warm cache without a new check.
        if (job.good && !closed) entries.forEach(target => { if (target.key === job.key) refresh(target); });
      });
    }

    const observer = win.IntersectionObserver ? new win.IntersectionObserver(rows => {
      prune();
      rows.forEach(row => { const entry = known.get(row.target); if (entry) { entry.visible = row.isIntersecting; if (entry.visible) refresh(entry); } });
    }, {rootMargin: '160px'}) : null;

    function watch(container) {
      if (closed) return;
      prune();
      for (const el of container.querySelectorAll('img[data-live-photo]')) {
        const key = photoURL(el.getAttribute('data-live-photo'));
        if (!key || known.has(el)) {
          if (known.has(el) && !observer) refresh(known.get(el));
          continue;
        }
        const url = photoURL(resolve(key));
        if (!url || !jobs.has(key) && jobs.size >= 16) continue;
        if (!jobs.has(key)) jobs.set(key, {key, url, lastAttempt: -Infinity, pending: null, good: false});
        const entry = {el, key, visible: !observer}; entries.add(entry); known.set(el, entry);
        if (observer) observer.observe(el);
        else if (el.getClientRects().length) refresh(entry);
      }
    }

    function suspend() { attempts.forEach(stop => stop.abort()); }
    function resume() {
      if (closed || doc.hidden) return;
      prune();
      entries.forEach(entry => { if (entry.el.getClientRects().length) refresh(entry); });
    }
    win.addEventListener('pagehide', suspend);
    win.addEventListener('pageshow', resume);
    win.addEventListener('online', resume);
    function visibility() { if (doc.hidden) suspend(); else resume(); }
    doc.addEventListener('visibilitychange', visibility);
    function close() {
      if (closed) return;
      closed = true; suspend(); observer && observer.disconnect(); entries.clear(); jobs.clear();
      win.removeEventListener('pagehide', suspend);
      win.removeEventListener('pageshow', resume);
      win.removeEventListener('online', resume);
      doc.removeEventListener('visibilitychange', visibility);
    }
    return {watch, close};
  }
  return {create};
})();
