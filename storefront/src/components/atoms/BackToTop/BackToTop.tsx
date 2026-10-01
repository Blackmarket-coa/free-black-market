"use client"

import { useState, useEffect } from "react"

const ArrowUpIcon = ({ className = "" }: { className?: string }) => (
  <svg 
    xmlns="http://www.w3.org/2000/svg" 
    fill="none" 
    viewBox="0 0 24 24" 
    strokeWidth={2} 
    stroke="currentColor" 
    className={className}
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
  </svg>
)

export function BackToTop() {
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    const toggleVisibility = () => {
      // Show button when page is scrolled down 400px
      if (window.scrollY > 400) {
        setIsVisible(true)
      } else {
        setIsVisible(false)
      }
    }

    window.addEventListener("scroll", toggleVisibility)

    return () => {
      window.removeEventListener("scroll", toggleVisibility)
    }
  }, [])

  const scrollToTop = () => {
    window.scrollTo({
      top: 0,
      behavior: "smooth",
    })
  }

  if (!isVisible) {
    return null
  }

  // Lifted clear of the cookie-consent banner while it is shown (see
  // ConsentBanner), so the banner never hides this button's focus.
  return (
    <button
      onClick={scrollToTop}
      aria-label="Back to top"
      className="fixed bottom-[calc(1.5rem+var(--fbm-consent-offset,0px))] right-6 z-40 p-3 bg-green-600 text-white rounded-full shadow-lg hover:bg-green-700 hover:shadow-xl transition-all duration-200 group"
    >
      <ArrowUpIcon className="w-5 h-5 group-hover:-translate-y-0.5 transition-transform" />
    </button>
  )
}
