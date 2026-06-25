import Image from "next/image"

import tailwindConfig from "../../../../tailwind.config"
import { ArrowRightIcon } from "@/icons"
import Link from "next/link"

type HeroProps = {
  image: string
  heading: string
  paragraph: string
  buttons: {
    label: string
    path: string
    eventName?: string
    eventLabel?: string
    progressTarget?: string
  }[]
  /** Mission-first variant: minimal, text-forward above-the-fold */
  variant?: "default" | "mission"
}

export const Hero = ({ image, heading, paragraph, buttons, variant = "default" }: HeroProps) => {
  // Mission-first variant: clean, values-focused solarpunk aesthetic
  if (variant === "mission") {
    return (
      <section className="w-full min-h-[60vh] flex flex-col justify-center px-6 lg:px-12 bg-gradient-nature relative overflow-hidden">
        {/* Subtle decorative leaf pattern overlay — kept light so it never
            competes with the headline for contrast. */}
        <div className="absolute inset-0 leaf-pattern opacity-30 pointer-events-none" />
        <div className="max-w-3xl relative z-10">
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-serif font-bold text-primary leading-tight">
            {heading}
          </h1>
          <p className="mt-6 text-lg md:text-xl font-normal text-primary max-w-xl leading-relaxed">
            {paragraph}
          </p>
          <div className="mt-10 flex flex-wrap gap-4">
            {buttons.map(({ label, path, eventName, eventLabel, progressTarget }, idx) => (
              <Link
                key={path}
                href={path}
                className={`inline-flex items-center gap-2 px-6 py-3 rounded-md font-medium transition-all duration-300 ${
                  idx === 0
                    ? "button-filled shadow-solarpunk-md hover:shadow-solarpunk-lg"
                    : "button-tonal text-action-on-secondary"
                }`}
                data-event={eventName}
                data-event-label={eventLabel ?? label}
                data-progress-target={progressTarget}
              >
                {label}
                <ArrowRightIcon
                  color={idx === 0 ? "#fffdfA" : "#268751"}
                  className="w-4 h-4"
                  aria-hidden
                />
              </Link>
            ))}
          </div>
        </div>
      </section>
    )
  }

  // Default variant: image-forward layout
  return (
    <section className="w-full flex container mt-5 flex-col lg:flex-row text-primary">
      <Image
        src={decodeURIComponent(image)}
        width={700}
        height={600}
        alt={`Hero banner - ${heading}`}
        className="w-full order-2 lg:order-1"
        priority
        fetchPriority="high"
        quality={50}
        sizes="(min-width: 1024px) 50vw, 100vw"
      />
      <div className="w-full lg:order-2">
        <div className="border border-forest rounded-md w-full px-6 flex items-end h-[calc(100%-144px)] card-organic">
          <div>
            <h2 className="font-bold mb-6 uppercase display-md max-w-[652px] text-4xl md:text-5xl leading-tight">
              {heading}
            </h2>
            <p className="text-lg mb-8">{paragraph}</p>
          </div>
        </div>
        {buttons.length && (
          <div className="h-[72px] lg:h-[144px] flex font-bold uppercase">
            {buttons.map(({ label, path, eventName, eventLabel, progressTarget }) => (
              <Link
                key={path}
                href={path}
                className="group flex border border-forest rounded-md h-full w-1/2 bg-gradient-solarpunk hover:bg-action hover:text-tertiary transition-all duration-300 p-6 justify-between items-end text-action-on-primary shadow-solarpunk-sm"
                aria-label={label}
                title={label}
                data-event={eventName}
                data-event-label={eventLabel ?? label}
                data-progress-target={progressTarget}
              >
                <span>
                  <span className="group-hover:inline-flex hidden">#</span>
                  {label}
                </span>

                <ArrowRightIcon
                  color={tailwindConfig.theme.extend.backgroundColor.primary}
                  aria-hidden
                />
              </Link>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
