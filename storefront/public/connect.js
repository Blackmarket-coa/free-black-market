/*!
 * FBM Connect — Free Black Market commerce, on any website.
 * https://freeblackmarket.com
 *
 * One <script> tag turns any site (Squarespace, Webflow, Wix, WordPress, raw
 * HTML, React — anything) into an FBM storefront. Three layers of integration,
 * pick the one that fits how much control you want:
 *
 *   1. Zero JS — drop an element, it renders itself:
 *        <div data-fbm="products" data-fbm-limit="6"></div>
 *        <div data-fbm="events"></div>
 *        <div data-fbm="vendor"></div>
 *
 *   2. Widgets — render styled UI into a container you choose:
 *        FBM.renderProducts('#shop', { limit: 6 })
 *        FBM.renderEvents('#events', { limit: 3 })
 *
 *   3. Raw API — get enriched data, build your own UI:
 *        const products = await FBM.getProducts()
 *        // each item has _price ("$12.00"), _cartUrl, _meta pre-computed
 *
 * Configure via the script tag:
 *   <script src="https://freeblackmarket.com/connect.js"
 *           data-fbm-handle="your-handle"
 *           data-fbm-api="https://api.freeblackmarket.com" async></script>
 *
 * No keys, no build step, no dependencies. MIT-spirited, framework-agnostic.
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
      var s = document.querySelectorAll("script[data-fbm-handle], script[src*='connect.js']");
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
    handle: attr("handle", ""),
    api: stripSlash(attr("api", "https://api.freeblackmarket.com")),
    storefront: stripSlash(attr("storefront", "")),
    region: attr("region", "us"),
    currency: attr("currency", "usd"),
    locale: attr("locale", "en-US"),
  };

  // ---------------------------------------------------------------------------
  // Data fetching (one network call per handle+include set, then cached)
  // ---------------------------------------------------------------------------
  var cache = {};
  var lastMeta = null;

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
      return Promise.reject(new Error("FBM: no vendor handle configured (set data-fbm-handle)."));
    }
    var key = handle + "|" + ((opts && opts.include) || "all") + "|" + ((opts && opts.currency) || config.currency);
    if (cache[key]) return cache[key];

    var p = fetch(buildUrl(handle, opts), {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "omit",
    })
      .then(function (res) {
        if (!res.ok) throw new Error("FBM: request failed (" + res.status + ")");
        return res.json();
      })
      .then(function (data) {
        lastMeta = data._meta || lastMeta;
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
  // Widgets — minimal, styled, overridable (.fbm-* classes)
  // ---------------------------------------------------------------------------
  var STYLE_ID = "fbm-connect-styles";
  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var css =
      ".fbm-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px;margin:0;padding:0;list-style:none}" +
      ".fbm-card{display:flex;flex-direction:column;border:1px solid #e5e5e5;border-radius:12px;overflow:hidden;background:#fff;text-decoration:none;color:inherit;transition:box-shadow .15s ease,transform .15s ease}" +
      ".fbm-card:hover{box-shadow:0 6px 20px rgba(0,0,0,.08);transform:translateY(-2px)}" +
      ".fbm-card__img{aspect-ratio:1/1;width:100%;object-fit:cover;background:#f5f5f5;display:block}" +
      ".fbm-card__body{padding:12px 14px;display:flex;flex-direction:column;gap:4px}" +
      ".fbm-card__title{font-weight:600;font-size:14px;line-height:1.3;margin:0}" +
      ".fbm-card__meta{font-size:13px;color:#666;margin:0}" +
      ".fbm-card__price{font-weight:600;font-size:14px;margin:2px 0 0}" +
      ".fbm-cta{margin-top:auto;display:inline-block;padding:8px 12px;border-radius:8px;background:#111;color:#fff;font-size:13px;font-weight:600;text-align:center;text-decoration:none}" +
      ".fbm-vendor{display:flex;align-items:center;gap:14px;padding:8px 0}" +
      ".fbm-vendor__avatar{width:56px;height:56px;border-radius:50%;object-fit:cover;background:#f0f0f0}" +
      ".fbm-vendor__name{font-weight:700;font-size:18px;margin:0;display:flex;align-items:center;gap:6px}" +
      ".fbm-vendor__verified{color:#1d9bf0;font-size:14px}" +
      ".fbm-vendor__desc{color:#555;font-size:14px;margin:2px 0 0}" +
      ".fbm-empty{color:#888;font-size:14px;padding:8px 0}" +
      ".fbm-powered{font-size:11px;color:#aaa;margin-top:10px}" +
      ".fbm-powered a{color:#888;text-decoration:none}";
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

  function resolveEl(target) {
    if (!target) return null;
    if (typeof target === "string") return document.querySelector(target);
    return target.nodeType ? target : null;
  }

  function setEmpty(node, msg) {
    node.innerHTML = '<p class="fbm-empty">' + escapeHtml(msg) + "</p>";
  }

  function poweredBy() {
    return (
      '<p class="fbm-powered">Powered by <a href="https://freeblackmarket.com" target="_blank" rel="noopener">Free Black Market</a></p>'
    );
  }

  function productCard(p) {
    var img = p.thumbnail
      ? '<img class="fbm-card__img" src="' + escapeHtml(p.thumbnail) + '" alt="' + escapeHtml(p.title) + '" loading="lazy">'
      : '<div class="fbm-card__img"></div>';
    return (
      '<a class="fbm-card" href="' + escapeHtml(p._cartUrl) + '" target="_blank" rel="noopener">' +
      img +
      '<div class="fbm-card__body">' +
      '<p class="fbm-card__title">' + escapeHtml(p.title) + "</p>" +
      (p._price ? '<p class="fbm-card__price">' + escapeHtml(p._price) + "</p>" : "") +
      '<span class="fbm-cta">Shop now</span>' +
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

  function renderInto(node, fetcher, cardFn, emptyMsg) {
    injectStyles();
    node.innerHTML = '<p class="fbm-empty">Loading…</p>';
    return fetcher
      .then(function (items) {
        if (!items || !items.length) {
          setEmpty(node, emptyMsg);
          return;
        }
        node.innerHTML =
          '<div class="fbm-grid">' + items.map(cardFn).join("") + "</div>" + poweredBy();
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
        node.innerHTML =
          '<div class="fbm-vendor">' +
          avatar +
          "<div>" +
          '<p class="fbm-vendor__name">' + escapeHtml(v.name) + verified + "</p>" +
          (v.description ? '<p class="fbm-vendor__desc">' + escapeHtml(v.description) + "</p>" : "") +
          "</div></div>";
      })
      .catch(function (err) {
        setEmpty(node, "Unable to load vendor.");
        if (window.console && console.warn) console.warn(err);
      });
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
        handle: node.getAttribute("data-fbm-handle") || config.handle,
        limit: parseInt(node.getAttribute("data-fbm-limit") || "", 10) || undefined,
        currency: node.getAttribute("data-fbm-currency") || undefined,
      };
      if (kind === "products") renderProducts(node, opts);
      else if (kind === "events") renderEvents(node, opts);
      else if (kind === "vendor") renderVendor(node, opts);
    });
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
    version: "1.0.0",
    config: config,
    configure: function (o) {
      for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) config[k] = o[k];
      cache = {}; // config change invalidates cache
      return FBM;
    },
    getData: getData,
    getVendor: getVendor,
    getProducts: getProducts,
    getEvents: getEvents,
    cartUrl: cartUrl,
    formatPrice: formatPrice,
    renderProducts: renderProducts,
    renderEvents: renderEvents,
    renderVendor: renderVendor,
    mount: autoMount,
  };

  window.FBM = FBM;

  ready(function () {
    injectStyles();
    autoMount(document);
  });
})(window, document);
