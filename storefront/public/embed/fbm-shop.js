/*!
 * Free Black Market shoppable embed widget
 *
 * Drop into any third-party HTML page:
 *
 *   <script src="https://your-storefront/embed/fbm-shop.js"
 *           data-creator="alex"
 *           data-locale="us"
 *           data-deal="deal_..."  (optional)
 *           data-width="480"     (optional, px)
 *           data-height="320"    (optional, px)
 *   ></script>
 *
 * Renders an iframe pointing at /[locale]/creators/[handle]/widget on the
 * storefront origin. The widget itself is a server-rendered Next page; this
 * bootstrap script just inserts the iframe at the script tag's location.
 *
 * No authentication, no cookies set from this script. All attribution
 * happens via /r/<short_code> redirects on the storefront origin once the
 * customer clicks through.
 */
(function () {
  "use strict"

  // Find the <script> tag that loaded us so we know where to insert the
  // iframe and where to read data-* attributes from.
  var scripts = document.getElementsByTagName("script")
  var self = null
  for (var i = scripts.length - 1; i >= 0; i--) {
    var src = scripts[i].src || ""
    if (src.indexOf("/embed/fbm-shop.js") !== -1) {
      self = scripts[i]
      break
    }
  }
  if (!self) return

  function attr(name, fallback) {
    var v = self.getAttribute("data-" + name)
    return v == null || v === "" ? fallback : v
  }

  var handle = attr("creator", null)
  if (!handle) {
    console.warn("[fbm-shop] missing data-creator attribute")
    return
  }
  var locale = attr("locale", "us")
  var dealId = attr("deal", null)
  var width = attr("width", "480")
  var height = attr("height", "320")

  // Storefront origin = origin the script was served from.
  var srcUrl
  try {
    srcUrl = new URL(self.src, window.location.href)
  } catch (e) {
    console.warn("[fbm-shop] could not parse script src", e)
    return
  }
  var origin = srcUrl.origin

  var widgetUrl =
    origin +
    "/" +
    encodeURIComponent(locale) +
    "/creators/" +
    encodeURIComponent(handle) +
    "/widget"
  if (dealId) widgetUrl += "?deal=" + encodeURIComponent(dealId)

  var iframe = document.createElement("iframe")
  iframe.src = widgetUrl
  iframe.setAttribute("title", "@" + handle + " — shoppable widget")
  iframe.setAttribute("loading", "lazy")
  iframe.setAttribute(
    "sandbox",
    "allow-scripts allow-same-origin allow-popups allow-top-navigation-by-user-activation"
  )
  iframe.style.border = "0"
  iframe.style.width = /^\d+$/.test(width) ? width + "px" : width
  iframe.style.height = /^\d+$/.test(height) ? height + "px" : height
  iframe.style.maxWidth = "100%"
  iframe.style.display = "block"

  if (self.parentNode) {
    self.parentNode.insertBefore(iframe, self.nextSibling)
  } else {
    document.body.appendChild(iframe)
  }
})()
