import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import "../styles.css";

const APP_NAME = "ReelBinder";
const APP_DESCRIPTION = "Plan a film from screenplay to cut.";
const APP_URL = "https://reelbinder.app/";
const APP_IMAGE = `${APP_URL}og.png`;
const APP_IMAGE_ALT = "ReelBinder logo and layered film-frame motif with the words From screenplay to cut.";

/**
 * Critical inline CSS: the first paint must match the app theme before the
 * (slow on drvfs) styles.css resolves — exact tokens copied from
 * src/styles.css (@theme background/foreground/primary/muted-foreground).
 * #boot-splash paints instantly and is hidden once the app sets
 * data-app-ready="1"; a 15s no-module fallback removes it so a failed
 * hydration can never trap a blank screen.
 */
const BOOT_CRITICAL_CSS = `
html, body { background: #0D0E11; color: #F1F0EA; }
html { font-family: "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
#boot-splash {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: #0D0E11;
  color: #F1F0EA;
  font-family: "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
}
#boot-splash .boot-wordmark {
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.08em;
  color: #E8E6DE;
}
#boot-splash .boot-hint {
  margin: 0;
  font-size: 12px;
  color: #A9AFBA;
}
#boot-splash .boot-spinner {
  width: 20px;
  height: 20px;
  border-radius: 9999px;
  border: 2px solid rgb(232 230 222 / 0.25);
  border-top-color: #E8E6DE;
  animation: boot-spin 0.8s linear infinite;
}
@keyframes boot-spin { to { transform: rotate(360deg); } }
html[data-app-ready="1"] #boot-splash { display: none; }
`;

/** No-module, no-network safety valve: untrap the splash at worst 15s after shell paint. */
const BOOT_FALLBACK_SCRIPT = `(function(){try{setTimeout(function(){document.documentElement.dataset.appReady="1";var s=document.getElementById("boot-splash");if(s)s.remove();},15000);}catch(e){}})();`;

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: APP_NAME },
      { name: "description", content: APP_DESCRIPTION },
      { name: "application-name", content: APP_NAME },
      { name: "apple-mobile-web-app-title", content: APP_NAME },
      { name: "theme-color", content: "#0D0E11" },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: APP_NAME },
      { property: "og:title", content: APP_NAME },
      { property: "og:description", content: APP_DESCRIPTION },
      { property: "og:url", content: APP_URL },
      { property: "og:image", content: APP_IMAGE },
      { property: "og:image:secure_url", content: APP_IMAGE },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:image:type", content: "image/png" },
      { property: "og:image:alt", content: APP_IMAGE_ALT },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: APP_NAME },
      { name: "twitter:description", content: APP_DESCRIPTION },
      { name: "twitter:image", content: APP_IMAGE },
      { name: "twitter:image:alt", content: APP_IMAGE_ALT },
    ],
    links: [
      { rel: "canonical", href: APP_URL },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon-32.png" },
      { rel: "icon", type: "image/png", sizes: "16x16", href: "/favicon-16.png" },
      { rel: "apple-touch-icon", sizes: "180x180", href: "/apple-touch-icon.png" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Courier+Prime:ital,wght@0,400;0,700;1,400&family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap",
      },
    ],
  }),
  component: () => (
    <html lang="en" className="antialiased" suppressHydrationWarning>
      <head>
        <HeadContent />
        {/* Critical paint CSS ships inline so the first frame is already themed
            even while the stylesheet link itself is still resolving. */}
        <style dangerouslySetInnerHTML={{ __html: BOOT_CRITICAL_CSS }} />
      </head>
      <body className="bg-background text-foreground" suppressHydrationWarning>
        <div id="boot-splash" role="status" aria-label="Loading ReelBinder" suppressHydrationWarning>
          <div className="boot-wordmark">ReelBinder</div>
          <div className="boot-spinner" aria-hidden="true" />
          <p className="boot-hint">From screenplay to cut.</p>
        </div>
        <Outlet />
        <Scripts />
        <script dangerouslySetInnerHTML={{ __html: BOOT_FALLBACK_SCRIPT }} />
      </body>
    </html>
  ),
});
