/*!
 * FBM Connect — Free Black Market commerce, on any website.
 * https://freeblackmarket.com
 *
 * One <script> tag turns any site (Squarespace, Webflow, Wix, WordPress, raw
 * HTML, React — anything) into an FBM storefront. Pick your integration depth:
 *
 *   1. Zero JS — drop an element, it renders itself:
 *        <div data-fbm="products"></div>     <div data-fbm="digital"></div>
 *        <div data-fbm="services"></div>      <div data-fbm="events"></div>
 *        <div data-fbm="reviews"></div>       <div data-fbm="vendor"></div>
 *        <div data-fbm="booking" data-fbm-product="prod_123"></div>
 *        <div data-fbm="chat"></div>
 *        <button data-fbm-buy="prod_123">Buy</button>
 *
 *   2. Widgets — render styled UI into a container you choose:
 *        FBM.renderProducts('#shop', { limit: 6 })
 *        FBM.renderBooking('#book', { product: 'prod_123' })
 *
 *   3. Raw API — get enriched data, build your own UI:
 *        const products = await FBM.getProducts()
 *        const slots    = await FBM.getBookingSlots('prod_123', '2026-07-01')
 *
 * Configure via the script tag:
 *   <script src="https://freeblackmarket.com/connect.js"
 *           data-fbm-vendor="your-handle"
 *           data-fbm-key="pk_live_…"           (optional — unlocks booking/chat/analytics)
 *           data-fbm-theme="light"             (light | dark | minimal)
 *           data-fbm-api="https://api.freeblackmarket.com" async></script>
 *
 * `data-fbm-handle` is still accepted as an alias for `data-fbm-vendor` so
 * existing keyless embeds keep working unchanged. No build step, no deps.
 */
(function (window, document) {
  "use strict";

  if (window.FBM && window.FBM.__loaded) {
    return; // already initialized
  }

  // ---------------------------------------------------------------------------
  // Configuration (read from the embedding <script> tag's data-* attributes)
  // ---------------------------------------------------------------------------
  var currentScript =
    document.currentScript ||
    (function () {
      var s = document.querySelectorAll(
        "script[data-fbm-vendor], script[data-fbm-handle], script[src*='connect.js']"
      );
      return s[s.length - 1] || null;
    })();

  function attr(name, fallback) {
    if (currentScript && currentScript.getAttribute) {
      var v = currentScript.getAttribute("data-fbm-" + name);
      if (v !== null && v !== "") return v;
    }
    return fallback;
  }

  function stripSlash(u) {
    return String(u || "").replace(/\/+$/, "");
  }

  var config = {
    // `vendor` is the new canonical name; `handle` kept as an alias.
    handle: attr("vendor", attr("handle", "")),
    key: attr("key", ""),
    api: stripSlash(attr("api", "https://api.freeblackmarket.com")),
    storefront: stripSlash(attr("storefront", "")),
    region: attr("region", "us"),
    currency: attr("currency", "usd"),
    locale: attr("locale", "en-US"),
    theme: attr("theme", "light"),
    checkout: attr("checkout", "redirect"), // redirect | modal
  };
  config.vendor = config.handle;

  // ---------------------------------------------------------------------------
  // Auth — send the publishable key when configured (keyless still works)
  // ---------------------------------------------------------------------------
  function authHeaders(extra) {
    var h = { Accept: "application/json" };
    if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) h[k] = extra[k];
    if (config.key) h["Authorization"] = "PublishableKey " + config.key;
    return h;
  }

  // ---------------------------------------------------------------------------
  // Data fetching (one network call per handle+include set, then cached)
  // ---------------------------------------------------------------------------
  var cache = {};
  var lastMeta = null;
  var lastData = null;

  function buildUrl(handle, opts) {
    var params = [];
    if (opts && opts.include) params.push("include=" + encodeURIComponent(opts.include));
    if (opts && opts.limitProducts) params.push("limit_products=" + opts.limitProducts);
    if (opts && opts.limitEvents) params.push("limit_events=" + opts.limitEvents);
    params.push("currency_code=" + encodeURIComponent((opts && opts.currency) || config.currency));
    return config.api + "/store/vendors/" + encodeURIComponent(handle) + "?" + params.join("&");
  }

  function getData(handle, opts) {
    handle = handle || config.handle;
    if (!handle) {
      return Promise.reject(new Error("FBM: no vendor configured (set data-fbm-vendor)."));
    }
    var key = handle + "|" + ((opts && opts.include) || "all") + "|" + ((opts && opts.currency) || config.currency);
    if (cache[key]) return cache[key];

    var p = fetch(buildUrl(handle, opts), {
      method: "GET",
      headers: authHeaders(),
      credentials: "omit",
    })
      .then(function (res) {
        if (!res.ok) throw new Error("FBM: request failed (" + res.status + ")");
        return res.json();
      })
      .then(function (data) {
        lastMeta = data._meta || lastMeta;
        lastData = data;
        return data;
      })
      .catch(function (err) {
        delete cache[key]; // allow retry
        throw err;
      });

    cache[key] = p;
    return p;
  }

  // ---------------------------------------------------------------------------
  // Enrichment — add _price, _cartUrl, _meta convenience fields
  // ---------------------------------------------------------------------------
  function formatPrice(price) {
    if (!price || typeof price.amount !== "number") return "";
    try {
      return new Intl.NumberFormat(config.locale, {
        style: "currency",
        currency: (price.currency_code || config.currency).toUpperCase(),
      }).format(price.amount);
    } catch (e) {
      return price.amount + " " + (price.currency_code || "");
    }
  }

  function storefrontBase(meta) {
    return (
      config.storefront ||
      (meta && meta.storefront_url) ||
      (lastMeta && lastMeta.storefront_url) ||
      config.api.replace(/\/\/api\./, "//")
    );
  }

  function productUrl(handle, meta) {
    return stripSlash(storefrontBase(meta)) + "/" + config.region + "/products/" + handle;
  }

  function enrichProduct(p, meta) {
    p._price = formatPrice(p.price);
    p._cartUrl = p.url || productUrl(p.handle, meta);
    p._meta = meta || lastMeta;
    return p;
  }

  function enrichEvent(e, meta) {
    e._price = formatPrice(e.price);
    e._cartUrl = e.url || (e.handle ? productUrl(e.handle, meta) : null);
    e._meta = meta || lastMeta;
    return e;
  }

  // ---------------------------------------------------------------------------
  // Argument normalization — every getX accepts (handle, opts) | (opts) | ()
  // ---------------------------------------------------------------------------
  function normalize(handle, opts) {
    if (handle && typeof handle === "object") {
      return { handle: config.handle, opts: handle };
    }
    return { handle: handle || config.handle, opts: opts || {} };
  }

  // ---------------------------------------------------------------------------
  // Public raw API
  // ---------------------------------------------------------------------------
  function getVendor(handle) {
    var a = normalize(handle);
    return getData(a.handle, { include: "vendor", currency: a.opts.currency }).then(function (d) {
      return d.vendor || null;
    });
  }

  function pickGroup(d, group) {
    // Prefer the grouped view from the expanded catalog; fall back to the flat
    // list filtered by `type` so older API responses still work.
    if (d.product_groups && d.product_groups[group]) return d.product_groups[group];
    var typeFor = { digital: "digital", services: "service", physical: "physical" };
    var t = typeFor[group];
    return (d.products || []).filter(function (p) {
      return p.type === t;
    });
  }

  function getProducts(handle, opts) {
    var a = normalize(handle, opts);
    return getData(a.handle, {
      include: "vendor,products",
      limitProducts: a.opts.limit,
      currency: a.opts.currency,
    }).then(function (d) {
      var meta = d._meta;
      return (d.products || []).map(function (p) {
        return enrichProduct(p, meta);
      });
    });
  }

  function getGroup(group, handle, opts) {
    var a = normalize(handle, opts);
    return getData(a.handle, {
      include: "vendor,products",
      limitProducts: a.opts.limit,
      currency: a.opts.currency,
    }).then(function (d) {
      var meta = d._meta;
      return pickGroup(d, group).map(function (p) {
        return enrichProduct(p, meta);
      });
    });
  }

  function getDigital(handle, opts) {
    return getGroup("digital", handle, opts);
  }
  function getServices(handle, opts) {
    return getGroup("services", handle, opts);
  }

  function getEvents(handle, opts) {
    var a = normalize(handle, opts);
    return getData(a.handle, {
      include: "vendor,events",
      limitEvents: a.opts.limit,
      currency: a.opts.currency,
    }).then(function (d) {
      var meta = d._meta;
      return (d.events || []).map(function (e) {
        return enrichEvent(e, meta);
      });
    });
  }

  function getReviews(handle, opts) {
    var a = normalize(handle, opts);
    var url =
      config.api +
      "/store/vendors/" +
      encodeURIComponent(a.handle) +
      "/reviews?limit=" +
      (a.opts.limit || 20);
    return fetch(url, { headers: authHeaders(), credentials: "omit" }).then(function (res) {
      if (!res.ok) throw new Error("FBM: reviews request failed (" + res.status + ")");
      return res.json();
    });
  }

  function getBookingSlots(productId, date, handle) {
    var h = handle || config.handle;
    var url =
      config.api +
      "/store/vendors/" +
      encodeURIComponent(h) +
      "/availability?product_id=" +
      encodeURIComponent(productId) +
      "&date=" +
      encodeURIComponent(date);
    return fetch(url, { headers: authHeaders(), credentials: "omit" })
      .then(function (res) {
        if (!res.ok) throw new Error("FBM: availability request failed (" + res.status + ")");
        return res.json();
      })
      .then(function (d) {
        return d.slots || [];
      });
  }

  function createBooking(payload) {
    if (!config.key) {
      return Promise.reject(new Error("FBM: a publishable key is required to book."));
    }
    return fetch(config.api + "/store/embed/bookings", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      credentials: "omit",
      body: JSON.stringify(payload),
    }).then(function (res) {
      return res.json().then(function (body) {
        if (!res.ok) throw new Error(body && body.message ? body.message : "Booking failed");
        return body;
      });
    });
  }

  function startChat(payload) {
    if (!config.key) {
      return Promise.reject(new Error("FBM: a publishable key is required to chat."));
    }
    return fetch(config.api + "/store/embed/chat/start", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      credentials: "omit",
      body: JSON.stringify(payload),
    }).then(function (res) {
      return res.json().then(function (body) {
        if (!res.ok) throw new Error(body && body.message ? body.message : "Could not start chat");
        return body;
      });
    });
  }

  // cartUrl():            -> the vendor's FBM cart/checkout URL
  // cartUrl(product):     -> that product's page (deep-link into checkout flow)
  // cartUrl("handle"):    -> that product handle's page
  function cartUrl(target) {
    if (!target) {
      return (
        (lastMeta && lastMeta.checkout_url) ||
        stripSlash(storefrontBase()) + "/" + config.region + "/cart"
      );
    }
    if (typeof target === "string") return productUrl(target);
    if (target && target.url) return target.url;
    if (target && target.handle) return productUrl(target.handle);
    return cartUrl();
  }

  // ---------------------------------------------------------------------------
  // Event emitter — FBM.on('cart:open' | 'order:complete' | 'booking:confirmed', fn)
  // ---------------------------------------------------------------------------
  var listeners = {};
  function on(name, fn) {
    (listeners[name] = listeners[name] || []).push(fn);
    return FBM;
  }
  function off(name, fn) {
    if (!listeners[name]) return FBM;
    listeners[name] = listeners[name].filter(function (f) {
      return f !== fn;
    });
    return FBM;
  }
  function emit(name, detail) {
    (listeners[name] || []).forEach(function (fn) {
      try {
        fn(detail);
      } catch (e) {
        if (window.console && console.warn) console.warn(e);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Analytics — batched, flushed on a timer and on pagehide (keyed embeds only)
  // ---------------------------------------------------------------------------
  var analyticsQueue = [];
  var flushTimer = null;
  // Generate a random token using the Web Crypto API (CSPRNG). Falls back to a
  // time-based id only if crypto is unavailable — never Math.random(), which is
  // not cryptographically secure.
  function randomToken() {
    try {
      var crypto = window.crypto || window.msCrypto;
      var bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      var out = "";
      for (var i = 0; i < bytes.length; i++) {
        out += (bytes[i] + 0x100).toString(16).slice(1);
      }
      return out;
    } catch (e) {
      return Date.now().toString(36);
    }
  }
  var sessionId = (function () {
    try {
      var k = "fbm_sid";
      var v = window.sessionStorage.getItem(k);
      if (!v) {
        v = "s_" + randomToken();
        window.sessionStorage.setItem(k, v);
      }
      return v;
    } catch (e) {
      return "s_" + Date.now().toString(36);
    }
  })();

  function track(eventType, props) {
    if (!config.key) return; // analytics ingestion is key-gated
    analyticsQueue.push({
      event_type: eventType,
      product_id: (props && props.product_id) || undefined,
      order_id: (props && props.order_id) || undefined,
      session_id: sessionId,
      metadata: props && props.metadata,
    });
    if (analyticsQueue.length >= 20) flushAnalytics();
    else if (!flushTimer) {
      flushTimer = window.setTimeout(flushAnalytics, 10000);
    }
  }

  function flushAnalytics(useKeepalive) {
    if (flushTimer) {
      window.clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (!config.key || !analyticsQueue.length) return;
    var batch = analyticsQueue.splice(0, analyticsQueue.length);
    try {
      // fetch+keepalive (NOT sendBeacon) because the endpoint needs the
      // Authorization header, which sendBeacon cannot set.
      fetch(config.api + "/store/embed/events", {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        credentials: "omit",
        keepalive: !!useKeepalive,
        body: JSON.stringify({ events: batch }),
      }).catch(function () {});
    } catch (e) {
      /* swallow — analytics must never break the host page */
    }
  }

  // ---------------------------------------------------------------------------
  // Styling — CSS custom properties + theme presets (overridable .fbm-*)
  // ---------------------------------------------------------------------------
  var STYLE_ID = "fbm-connect-styles";
  var THEMES = {
    light: { bg: "#fff", fg: "#111", muted: "#666", border: "#e5e5e5", accent: "#111", accentFg: "#fff" },
    dark: { bg: "#161616", fg: "#f5f5f5", muted: "#a0a0a0", border: "#2c2c2c", accent: "#f5f5f5", accentFg: "#111" },
    minimal: { bg: "transparent", fg: "#111", muted: "#888", border: "#ddd", accent: "#111", accentFg: "#fff" },
    warm: { bg: "#fdf6ee", fg: "#3a2a1a", muted: "#8a6f57", border: "#ecdcc7", accent: "#b45309", accentFg: "#fff" },
    forest: { bg: "#f3f7f3", fg: "#14251a", muted: "#5c7263", border: "#d4e2d6", accent: "#1f5132", accentFg: "#fff" },
  };

  function themeVars(name) {
    var t = THEMES[name] || THEMES.light;
    return (
      "--fbm-bg:" + t.bg + ";--fbm-fg:" + t.fg + ";--fbm-muted:" + t.muted +
      ";--fbm-border:" + t.border + ";--fbm-accent:" + t.accent + ";--fbm-accent-fg:" + t.accentFg + ";"
    );
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var css =
      ":root{" + themeVars(config.theme) + "}" +
      ".fbm-scope{color:var(--fbm-fg)}" +
      ".fbm-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px;margin:0;padding:0;list-style:none}" +
      ".fbm-card{display:flex;flex-direction:column;border:1px solid var(--fbm-border);border-radius:12px;overflow:hidden;background:var(--fbm-bg);text-decoration:none;color:inherit;transition:box-shadow .15s ease,transform .15s ease}" +
      ".fbm-card:hover{box-shadow:0 6px 20px rgba(0,0,0,.08);transform:translateY(-2px)}" +
      ".fbm-card__img{aspect-ratio:1/1;width:100%;object-fit:cover;background:#f5f5f5;display:block}" +
      ".fbm-card__body{padding:12px 14px;display:flex;flex-direction:column;gap:4px}" +
      ".fbm-card__title{font-weight:600;font-size:14px;line-height:1.3;margin:0}" +
      ".fbm-card__meta{font-size:13px;color:var(--fbm-muted);margin:0}" +
      ".fbm-card__price{font-weight:600;font-size:14px;margin:2px 0 0}" +
      ".fbm-cta,.fbm-btn{margin-top:auto;display:inline-block;padding:8px 12px;border-radius:8px;background:var(--fbm-accent);color:var(--fbm-accent-fg);font-size:13px;font-weight:600;text-align:center;text-decoration:none;border:0;cursor:pointer}" +
      ".fbm-btn[disabled]{opacity:.5;cursor:default}" +
      ".fbm-vendor{display:flex;align-items:center;gap:14px;padding:8px 0}" +
      ".fbm-vendor__avatar{width:56px;height:56px;border-radius:50%;object-fit:cover;background:#f0f0f0}" +
      ".fbm-vendor__name{font-weight:700;font-size:18px;margin:0;display:flex;align-items:center;gap:6px}" +
      ".fbm-vendor__verified{color:#1d9bf0;font-size:14px}" +
      ".fbm-vendor__desc{color:var(--fbm-muted);font-size:14px;margin:2px 0 0}" +
      ".fbm-empty{color:var(--fbm-muted);font-size:14px;padding:8px 0}" +
      ".fbm-stars{color:#f5a623;font-size:15px;letter-spacing:1px}" +
      ".fbm-review{border:1px solid var(--fbm-border);border-radius:10px;padding:12px 14px;margin:0 0 10px;background:var(--fbm-bg)}" +
      ".fbm-review__head{display:flex;justify-content:space-between;align-items:center;font-size:13px;color:var(--fbm-muted)}" +
      ".fbm-review__body{font-size:14px;margin:6px 0 0}" +
      ".fbm-field{display:flex;flex-direction:column;gap:4px;margin:0 0 10px;font-size:13px}" +
      ".fbm-field input,.fbm-field textarea,.fbm-field select{padding:8px 10px;border:1px solid var(--fbm-border);border-radius:8px;font:inherit;background:var(--fbm-bg);color:var(--fbm-fg)}" +
      ".fbm-slots{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0}" +
      ".fbm-slot{padding:6px 10px;border:1px solid var(--fbm-border);border-radius:8px;background:var(--fbm-bg);color:var(--fbm-fg);cursor:pointer;font-size:13px}" +
      ".fbm-slot.is-selected{background:var(--fbm-accent);color:var(--fbm-accent-fg)}" +
      ".fbm-modal{position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:2147483000}" +
      ".fbm-modal__panel{background:var(--fbm-bg);color:var(--fbm-fg);width:min(560px,94vw);height:min(680px,92vh);border-radius:14px;overflow:hidden;position:relative;box-shadow:0 20px 60px rgba(0,0,0,.4)}" +
      ".fbm-modal__close{position:absolute;top:8px;right:10px;background:rgba(0,0,0,.4);color:#fff;border:0;border-radius:50%;width:30px;height:30px;font-size:18px;cursor:pointer;z-index:2}" +
      ".fbm-modal__panel iframe{width:100%;height:100%;border:0}" +
      ".fbm-powered{font-size:11px;color:var(--fbm-muted);margin-top:10px}" +
      ".fbm-powered a{color:var(--fbm-muted);text-decoration:none}";
    var style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // Defense-in-depth: only ever navigate/frame http(s) URLs. These come from the
  // FBM API today, but this stops a `javascript:`/`data:` value from ever
  // reaching an iframe src or window.open.
  function safeUrl(url) {
    var s = String(url == null ? "" : url).trim();
    return /^https?:\/\//i.test(s) ? s : "";
  }

  function openUrl(url) {
    var safe = safeUrl(url);
    if (safe) window.open(safe, "_blank", "noopener");
  }

  function resolveEl(target) {
    if (!target) return null;
    if (typeof target === "string") return document.querySelector(target);
    return target.nodeType ? target : null;
  }

  function setEmpty(node, msg) {
    node.innerHTML = '<p class="fbm-empty">' + escapeHtml(msg) + "</p>";
  }

  function poweredBy() {
    return '<p class="fbm-powered">Powered by <a href="https://freeblackmarket.com" target="_blank" rel="noopener">Free Black Market</a></p>';
  }

  function scope(html) {
    return '<div class="fbm-scope">' + html + "</div>";
  }

  // ---------------------------------------------------------------------------
  // Cart / checkout
  // ---------------------------------------------------------------------------
  function openCart(target) {
    var url = cartUrl(target);
    emit("cart:open", { url: url, target: target });
    track("checkout_start", { product_id: target && target.id });
    if (config.checkout === "modal") {
      openModal(url);
    } else {
      openUrl(url);
    }
    return url;
  }

  function openModal(url) {
    var safe = safeUrl(url);
    if (!safe) return;
    injectStyles();
    var overlay = document.createElement("div");
    overlay.className = "fbm-modal";
    overlay.innerHTML =
      '<div class="fbm-modal__panel"><button class="fbm-modal__close" aria-label="Close">×</button>' +
      '<iframe src="' + escapeHtml(safe) + '" allow="payment"></iframe></div>';
    function close() {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      document.removeEventListener("keydown", onKey);
    }
    function onKey(e) {
      if (e.key === "Escape") close();
    }
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) close();
    });
    overlay.querySelector(".fbm-modal__close").addEventListener("click", close);
    document.addEventListener("keydown", onKey);
    document.body.appendChild(overlay);
    return close;
  }

  // ---------------------------------------------------------------------------
  // Card renderers
  // ---------------------------------------------------------------------------
  function productCard(p) {
    var img = p.thumbnail
      ? '<img class="fbm-card__img" src="' + escapeHtml(p.thumbnail) + '" alt="' + escapeHtml(p.title) + '" loading="lazy">'
      : '<div class="fbm-card__img"></div>';
    return (
      '<a class="fbm-card" href="' + escapeHtml(p._cartUrl) + '" target="_blank" rel="noopener" data-fbm-pid="' + escapeHtml(p.id) + '">' +
      img +
      '<div class="fbm-card__body">' +
      '<p class="fbm-card__title">' + escapeHtml(p.title) + "</p>" +
      (p._price ? '<p class="fbm-card__price">' + escapeHtml(p._price) + "</p>" : "") +
      '<span class="fbm-cta">' + (p.type === "digital" ? "Get it" : "Shop now") + "</span>" +
      "</div></a>"
    );
  }

  function eventCard(e) {
    var when = Array.isArray(e.dates) && e.dates.length ? e.dates[0] : "";
    var venue = e.venue && e.venue.name ? e.venue.name : "";
    var sub = [when, venue].filter(Boolean).join(" · ");
    var href = e._cartUrl || cartUrl();
    var img = e.thumbnail
      ? '<img class="fbm-card__img" src="' + escapeHtml(e.thumbnail) + '" alt="' + escapeHtml(e.title) + '" loading="lazy">'
      : "";
    return (
      '<a class="fbm-card" href="' + escapeHtml(href) + '" target="_blank" rel="noopener">' +
      img +
      '<div class="fbm-card__body">' +
      '<p class="fbm-card__title">' + escapeHtml(e.title) + "</p>" +
      (sub ? '<p class="fbm-card__meta">' + escapeHtml(sub) + "</p>" : "") +
      (e._price ? '<p class="fbm-card__price">' + escapeHtml(e._price) + "</p>" : "") +
      '<span class="fbm-cta">Get tickets</span>' +
      "</div></a>"
    );
  }

  function stars(rating) {
    var r = Math.round(Number(rating) || 0);
    if (r < 0) r = 0;
    if (r > 5) r = 5;
    var full = "★★★★★".slice(0, r);
    var empty = "☆☆☆☆☆".slice(0, 5 - r);
    return '<span class="fbm-stars">' + full + empty + "</span>";
  }

  // ---------------------------------------------------------------------------
  // Grid widgets
  // ---------------------------------------------------------------------------
  function renderInto(node, fetcher, cardFn, emptyMsg) {
    injectStyles();
    node.innerHTML = '<p class="fbm-empty">Loading…</p>';
    return fetcher
      .then(function (items) {
        if (!items || !items.length) {
          setEmpty(node, emptyMsg);
          return;
        }
        node.innerHTML = scope(
          '<div class="fbm-grid">' + items.map(cardFn).join("") + "</div>" + poweredBy()
        );
        track("view", { metadata: { kind: "grid", count: items.length } });
      })
      .catch(function (err) {
        setEmpty(node, "Unable to load right now.");
        if (window.console && console.warn) console.warn(err);
      });
  }

  function renderProducts(target, opts) {
    var node = resolveEl(target);
    if (!node) return Promise.resolve();
    opts = opts || {};
    return renderInto(node, getProducts(opts.handle, opts), productCard, "No products yet.");
  }
  function renderDigital(target, opts) {
    var node = resolveEl(target);
    if (!node) return Promise.resolve();
    opts = opts || {};
    return renderInto(node, getDigital(opts.handle, opts), productCard, "No digital products yet.");
  }
  function renderServices(target, opts) {
    var node = resolveEl(target);
    if (!node) return Promise.resolve();
    opts = opts || {};
    return renderInto(node, getServices(opts.handle, opts), productCard, "No services yet.");
  }
  function renderEvents(target, opts) {
    var node = resolveEl(target);
    if (!node) return Promise.resolve();
    opts = opts || {};
    return renderInto(node, getEvents(opts.handle, opts), eventCard, "No upcoming events.");
  }

  function renderVendor(target, opts) {
    var node = resolveEl(target);
    if (!node) return Promise.resolve();
    injectStyles();
    opts = opts || {};
    return getVendor(opts.handle)
      .then(function (v) {
        if (!v) {
          setEmpty(node, "Vendor not found.");
          return;
        }
        var avatar = v.photo
          ? '<img class="fbm-vendor__avatar" src="' + escapeHtml(v.photo) + '" alt="' + escapeHtml(v.name) + '">'
          : '<div class="fbm-vendor__avatar"></div>';
        var verified = v.verified ? '<span class="fbm-vendor__verified" title="Verified">✔</span>' : "";
        node.innerHTML = scope(
          '<div class="fbm-vendor">' +
            avatar +
            "<div>" +
            '<p class="fbm-vendor__name">' + escapeHtml(v.name) + verified + "</p>" +
            (v.description ? '<p class="fbm-vendor__desc">' + escapeHtml(v.description) + "</p>" : "") +
            "</div></div>"
        );
      })
      .catch(function (err) {
        setEmpty(node, "Unable to load vendor.");
        if (window.console && console.warn) console.warn(err);
      });
  }

  function renderReviews(target, opts) {
    var node = resolveEl(target);
    if (!node) return Promise.resolve();
    injectStyles();
    opts = opts || {};
    node.innerHTML = '<p class="fbm-empty">Loading…</p>';
    return getReviews(opts.handle, opts)
      .then(function (data) {
        var reviews = (data && data.reviews) || [];
        var summary = (data && data.summary) || {};
        if (!reviews.length) {
          setEmpty(node, "No reviews yet.");
          return;
        }
        var head =
          summary.average != null
            ? '<p class="fbm-card__meta">' + stars(summary.average) + " " +
              escapeHtml(summary.average) + " · " + escapeHtml(summary.count) + " reviews</p>"
            : "";
        var list = reviews
          .map(function (r) {
            return (
              '<div class="fbm-review"><div class="fbm-review__head"><span>' +
              stars(r.rating) +
              " " +
              escapeHtml(r.author || "Verified buyer") +
              "</span>" +
              (r.verified ? "<span>✔ Verified</span>" : "") +
              "</div>" +
              (r.title ? '<p class="fbm-card__title">' + escapeHtml(r.title) + "</p>" : "") +
              (r.body ? '<p class="fbm-review__body">' + escapeHtml(r.body) + "</p>" : "") +
              "</div>"
            );
          })
          .join("");
        node.innerHTML = scope(head + list + poweredBy());
      })
      .catch(function (err) {
        setEmpty(node, "Unable to load reviews.");
        if (window.console && console.warn) console.warn(err);
      });
  }

  // ---------------------------------------------------------------------------
  // Booking widget — month-free simple date input + slot picker + form
  // ---------------------------------------------------------------------------
  function todayInTz() {
    try {
      return new Date().toISOString().slice(0, 10);
    } catch (e) {
      return "";
    }
  }

  function renderBooking(target, opts) {
    var node = resolveEl(target);
    if (!node) return Promise.resolve();
    injectStyles();
    opts = opts || {};
    var productId = opts.product || opts.productId;
    var handle = opts.handle || config.handle;
    if (!productId) {
      setEmpty(node, "Booking needs a product (data-fbm-product).");
      return Promise.resolve();
    }
    track("booking_open", { product_id: productId });

    var selected = null;
    var date = todayInTz();

    function shell(inner) {
      node.innerHTML = scope(
        '<div class="fbm-field"><label>Choose a date</label>' +
          '<input type="date" class="fbm-date" value="' + escapeHtml(date) + '" min="' + escapeHtml(todayInTz()) + '"></div>' +
          '<div class="fbm-slots-wrap">' + inner + "</div>" +
          '<form class="fbm-book-form" style="display:none">' +
          '<div class="fbm-field"><label>Your name</label><input type="text" name="name" required></div>' +
          '<div class="fbm-field"><label>Email</label><input type="email" name="email" required></div>' +
          '<div class="fbm-field"><label>Notes (optional)</label><textarea name="notes" rows="2"></textarea></div>' +
          '<button type="submit" class="fbm-btn">Request booking</button>' +
          "</form>" +
          poweredBy()
      );
      wire();
    }

    function loadSlots() {
      var wrap = node.querySelector(".fbm-slots-wrap");
      if (wrap) wrap.innerHTML = '<p class="fbm-empty">Loading times…</p>';
      return getBookingSlots(productId, date, handle)
        .then(function (slots) {
          if (!slots.length) {
            if (wrap) wrap.innerHTML = '<p class="fbm-empty">No times available on this date.</p>';
            return;
          }
          var html =
            '<div class="fbm-slots">' +
            slots
              .map(function (s) {
                var label = new Date(s.starts_at).toLocaleTimeString(config.locale, {
                  hour: "numeric",
                  minute: "2-digit",
                });
                return '<button type="button" class="fbm-slot" data-start="' + escapeHtml(s.starts_at) + '">' + escapeHtml(label) + "</button>";
              })
              .join("") +
            "</div>";
          if (wrap) wrap.innerHTML = html;
          wireSlots();
        })
        .catch(function () {
          if (wrap) wrap.innerHTML = '<p class="fbm-empty">Unable to load times.</p>';
        });
    }

    function wireSlots() {
      var btns = node.querySelectorAll(".fbm-slot");
      Array.prototype.forEach.call(btns, function (b) {
        b.addEventListener("click", function () {
          selected = b.getAttribute("data-start");
          Array.prototype.forEach.call(btns, function (x) {
            x.classList.remove("is-selected");
          });
          b.classList.add("is-selected");
          var form = node.querySelector(".fbm-book-form");
          if (form) form.style.display = "block";
        });
      });
    }

    function wire() {
      var dateEl = node.querySelector(".fbm-date");
      if (dateEl) {
        dateEl.addEventListener("change", function () {
          date = dateEl.value;
          selected = null;
          var form = node.querySelector(".fbm-book-form");
          if (form) form.style.display = "none";
          loadSlots();
        });
      }
      var form = node.querySelector(".fbm-book-form");
      if (form) {
        form.addEventListener("submit", function (e) {
          e.preventDefault();
          if (!selected) return;
          var btn = form.querySelector("button[type=submit]");
          if (btn) {
            btn.setAttribute("disabled", "1");
            btn.textContent = "Booking…";
          }
          createBooking({
            product_id: productId,
            starts_at: selected,
            customer_email: form.email.value,
            customer_name: form.name.value,
            notes: form.notes.value,
          })
            .then(function (res) {
              emit("booking:confirmed", res);
              track("booking_confirm", { product_id: productId });
              if (res.checkout_url && config.checkout !== "none") {
                node.innerHTML = scope('<p class="fbm-empty">Booking created — taking you to checkout…</p>');
                openUrl(res.checkout_url);
              } else {
                node.innerHTML = scope('<p class="fbm-empty">✓ Booking requested! The vendor will confirm by email.</p>');
              }
            })
            .catch(function (err) {
              if (btn) {
                btn.removeAttribute("disabled");
                btn.textContent = "Request booking";
              }
              alert((err && err.message) || "Booking failed. Please try another time.");
            });
        });
      }
    }

    shell('<p class="fbm-empty">Loading times…</p>');
    return loadSlots();
  }

  // ---------------------------------------------------------------------------
  // Chat widget — button → form → Matrix widget (or email fallback)
  // ---------------------------------------------------------------------------
  function renderChat(target, opts) {
    var node = resolveEl(target);
    if (!node) return Promise.resolve();
    injectStyles();
    opts = opts || {};
    var label = opts.label || "Message the vendor";

    node.innerHTML = scope('<button type="button" class="fbm-btn fbm-chat-open">' + escapeHtml(label) + "</button>");
    node.querySelector(".fbm-chat-open").addEventListener("click", function () {
      track("chat_open", {});
      node.innerHTML = scope(
        '<form class="fbm-chat-form">' +
          '<div class="fbm-field"><label>Email</label><input type="email" name="email" required></div>' +
          '<div class="fbm-field"><label>Message</label><textarea name="message" rows="3" required></textarea></div>' +
          '<button type="submit" class="fbm-btn">Send</button>' +
          "</form>"
      );
      var form = node.querySelector(".fbm-chat-form");
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var btn = form.querySelector("button[type=submit]");
        if (btn) {
          btn.setAttribute("disabled", "1");
          btn.textContent = "Sending…";
        }
        startChat({
          customer_email: form.email.value,
          message: form.message.value,
        })
          .then(function (res) {
            if (res.widget_url) {
              node.innerHTML = scope('<p class="fbm-empty">Connecting you to the vendor…</p>');
              openModal(res.widget_url);
            } else {
              node.innerHTML = scope('<p class="fbm-empty">✓ Sent! The vendor will reply to your email.</p>');
            }
          })
          .catch(function (err) {
            if (btn) {
              btn.removeAttribute("disabled");
              btn.textContent = "Send";
            }
            alert((err && err.message) || "Couldn't send your message.");
          });
      });
    });
    return Promise.resolve();
  }

  // ---------------------------------------------------------------------------
  // Buy buttons — [data-fbm-buy="prod_or_handle"]
  // ---------------------------------------------------------------------------
  function wireBuyButtons(root) {
    var nodes = (root || document).querySelectorAll("[data-fbm-buy]");
    Array.prototype.forEach.call(nodes, function (node) {
      if (node.getAttribute("data-fbm-buy-wired")) return;
      node.setAttribute("data-fbm-buy-wired", "1");
      node.addEventListener("click", function (e) {
        e.preventDefault();
        openCart(node.getAttribute("data-fbm-buy"));
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Capability gating — the vendor toggles which surfaces their embed shows
  // from the FBM portal. The Store API returns a `capabilities` map; a surface
  // is hidden only when its flag is explicitly false, so an older API that
  // omits capabilities still renders everything (opt-out, never opt-in).
  // ---------------------------------------------------------------------------
  var CAP_FOR_KIND = {
    vendor: "vendor_enabled",
    products: "products_enabled",
    digital: "digital_enabled",
    services: "services_enabled",
    events: "events_enabled",
    reviews: "reviews_enabled",
    booking: "booking_enabled",
    chat: "chat_enabled",
  };

  function getCapabilities(handle) {
    return getData(handle || config.handle, { include: "vendor,products,events" })
      .then(function (d) {
        return (d && d.capabilities) || {};
      })
      .catch(function () {
        return {}; // never block rendering on a failed capabilities probe
      });
  }

  function renderKind(kind, node, opts) {
    if (kind === "products") renderProducts(node, opts);
    else if (kind === "digital") renderDigital(node, opts);
    else if (kind === "services") renderServices(node, opts);
    else if (kind === "events") renderEvents(node, opts);
    else if (kind === "reviews") renderReviews(node, opts);
    else if (kind === "vendor") renderVendor(node, opts);
    else if (kind === "booking") renderBooking(node, opts);
    else if (kind === "chat") renderChat(node, opts);
  }

  // ---------------------------------------------------------------------------
  // Zero-JS auto-mount: scan for [data-fbm] elements and render them
  // ---------------------------------------------------------------------------
  function autoMount(root) {
    root = root || document;
    var nodes = root.querySelectorAll("[data-fbm]");
    Array.prototype.forEach.call(nodes, function (node) {
      if (node.getAttribute("data-fbm-mounted")) return;
      node.setAttribute("data-fbm-mounted", "1");
      var kind = node.getAttribute("data-fbm");
      var opts = {
        handle: node.getAttribute("data-fbm-vendor") || node.getAttribute("data-fbm-handle") || config.handle,
        limit: parseInt(node.getAttribute("data-fbm-limit") || "", 10) || undefined,
        currency: node.getAttribute("data-fbm-currency") || undefined,
        product: node.getAttribute("data-fbm-product") || undefined,
        label: node.getAttribute("data-fbm-label") || undefined,
      };
      var capKey = CAP_FOR_KIND[kind];
      getCapabilities(opts.handle).then(function (caps) {
        // Vendor turned this surface off — render nothing.
        if (capKey && caps[capKey] === false) {
          node.innerHTML = "";
          return;
        }
        renderKind(kind, node, opts);
      });
    });
    wireBuyButtons(root);
  }

  function ready(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn);
    } else {
      fn();
    }
  }

  // ---------------------------------------------------------------------------
  // Expose & boot
  // ---------------------------------------------------------------------------
  var FBM = {
    __loaded: true,
    version: "2.0.0",
    config: config,
    configure: function (o) {
      for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) config[k] = o[k];
      if (o && (o.vendor || o.handle)) config.handle = config.vendor = o.vendor || o.handle;
      cache = {}; // config change invalidates cache
      return FBM;
    },
    // raw data
    getData: getData,
    getVendor: getVendor,
    getProducts: getProducts,
    getDigital: getDigital,
    getServices: getServices,
    getEvents: getEvents,
    getReviews: getReviews,
    getBookingSlots: getBookingSlots,
    createBooking: createBooking,
    startChat: startChat,
    // cart / checkout
    cartUrl: cartUrl,
    openCart: openCart,
    openModal: openModal,
    formatPrice: formatPrice,
    // widgets
    renderProducts: renderProducts,
    renderDigital: renderDigital,
    renderServices: renderServices,
    renderEvents: renderEvents,
    renderReviews: renderReviews,
    renderVendor: renderVendor,
    renderBooking: renderBooking,
    renderChat: renderChat,
    openBooking: renderBooking,
    openChat: renderChat,
    mount: autoMount,
    // events + analytics
    on: on,
    off: off,
    track: track,
  };

  window.FBM = FBM;

  // Flush any queued analytics when the page is hidden/unloaded.
  window.addEventListener("pagehide", function () {
    flushAnalytics(true);
  });
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") flushAnalytics(true);
  });

  ready(function () {
    injectStyles();
    autoMount(document);
  });
})(window, document);
