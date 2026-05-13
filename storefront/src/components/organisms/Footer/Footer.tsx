import LocalizedClientLink from "@/components/molecules/LocalizedLink/LocalizedLink"
import { BugReportButton } from "@/components/molecules/BugReportButton/BugReportButton"
import footerLinks from "@/data/footerLinks"

// Client component for copyright year to prevent hydration mismatch
function CopyrightYear() {
  // Use suppressHydrationWarning since new Date().getFullYear() will differ
  // between server and client render times, but the difference is acceptable
  return <span suppressHydrationWarning>{new Date().getFullYear()}</span>
}

export function Footer() {
  return (
    <footer className="bg-primary container">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
        {/* Customer Services Column */}
        <div className="p-6 border rounded-sm hover:shadow-solarpunk-sm transition-shadow duration-300">
          <h2 className="heading-sm text-primary mb-3 uppercase">
            Customer services
          </h2>
          <nav className="space-y-3" aria-label="Customer services navigation">
            {footerLinks.customerServices.map(({ label, path }) => (
              <LocalizedClientLink
                key={label}
                href={path}
                className="block label-md hover:text-action transition-colors duration-200"
              >
                {label}
              </LocalizedClientLink>
            ))}
            <BugReportButton />
          </nav>
        </div>

        {/* About Column */}
        <div className="p-6 border rounded-sm hover:shadow-solarpunk-sm transition-shadow duration-300">
          <h2 className="heading-sm text-primary mb-3 uppercase">About</h2>
          <nav className="space-y-3" aria-label="About navigation">
            {footerLinks.about.map(({ label, path }) => (
              path.startsWith('http') ? (
                <a
                  key={label}
                  href={path}
                  className="block label-md hover:text-action transition-colors duration-200"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {label}
                </a>
              ) : (
                <LocalizedClientLink
                  key={label}
                  href={path}
                  className="block label-md hover:text-action transition-colors duration-200"
                >
                  {label}
                </LocalizedClientLink>
              )
            ))}
          </nav>
        </div>

        {/* Connect Column */}
        <div className="p-6 border rounded-sm hover:shadow-solarpunk-sm transition-shadow duration-300">
          <h2 className="heading-sm text-primary mb-3 uppercase">connect</h2>
          <nav className="space-y-3" aria-label="Social media navigation">
            {footerLinks.connect.map(({ label, path }) => (
              <a
                aria-label={`Go to ${label} page`}
                title={`Go to ${label} page`}
                key={label}
                href={path}
                className="block label-md hover:text-action transition-colors duration-200"
                target="_blank"
                rel="noopener noreferrer"
              >
                {label}
              </a>
            ))}
          </nav>
        </div>
      </div>


      <div className="mt-4 rounded-sm border p-4 text-sm text-secondary">
        <p className="font-semibold mb-1">Open Source. Community Governed.</p>
        <p className="mb-2">Improved onboarding system with transparent public roadmap and code.</p>
        <a
          href="https://github.com"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-action"
        >
          View GitHub transparency
        </a>
      </div>

      {/* Solarpunk-styled footer bottom with gradient accent */}
      <div className="py-6 border rounded-sm relative overflow-hidden">
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-solarpunk" />
        <p className="text-md text-secondary text-center">© <CopyrightYear /> Black Market Coalition LLC</p>
      </div>
    </footer>
  )
}
