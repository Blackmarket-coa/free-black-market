import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { setStance, type Stance } from "@/lib/data/progression"

export const metadata: Metadata = {
  title: "What are you doing today?",
  description:
    "Choose your stance — Produce, Acquire, Invest, or Support — and step into the Free Black Market economy.",
}

type StanceCard = {
  stance: Stance
  emoji: string
  title: string
  blurb: string
  destination: string
  accent: string
}

const CARDS: StanceCard[] = [
  {
    stance: "producer",
    emoji: "🌱",
    title: "Produce",
    blurb: "Grow, make, and sell. List goods and offer services.",
    destination: "/sellers",
    accent: "border-green-600 hover:bg-green-50",
  },
  {
    stance: "consumer",
    emoji: "🛒",
    title: "Acquire",
    blurb: "Find what you need from producers near you.",
    destination: "/shop",
    accent: "border-amber-500 hover:bg-amber-50",
  },
  {
    stance: "investor",
    emoji: "💰",
    title: "Invest",
    blurb: "Fund farms, workshops, projects, and creators.",
    destination: "/invest",
    accent: "border-amber-700 hover:bg-amber-50",
  },
  {
    stance: "coalition",
    emoji: "🤝",
    title: "Support",
    blurb: "Volunteer, deliver, mentor, and build the coalition.",
    destination: "/community-resources",
    accent: "border-green-800 hover:bg-green-50",
  },
]

/**
 * Server action: persist the chosen stance (cookie + backend when logged in)
 * and route the user into the matching surface.
 */
async function chooseStance(formData: FormData) {
  "use server"
  const stance = formData.get("stance") as Stance
  const destination = (formData.get("destination") as string) || "/shop"
  await setStance(stance)
  redirect(destination)
}

export default function StartPage() {
  return (
    <main className="container py-10">
      <header className="text-center max-w-2xl mx-auto mb-10">
        <h1 className="heading-xl">What are you doing today?</h1>
        <p className="text-secondary mt-3">
          Free Black Market is organized around people and roles, not just
          products. Pick a stance to begin — you can switch any time.
        </p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 max-w-5xl mx-auto">
        {CARDS.map((card) => (
          <form key={card.stance} action={chooseStance}>
            <input type="hidden" name="stance" value={card.stance} />
            <input type="hidden" name="destination" value={card.destination} />
            <button
              type="submit"
              className={`group w-full h-full text-left rounded-xl border-2 ${card.accent} bg-primary p-6 transition-colors shadow-solarpunk-sm hover:shadow-solarpunk-md`}
            >
              <span className="text-4xl" aria-hidden>
                {card.emoji}
              </span>
              <h2 className="heading-md mt-4">{card.title}</h2>
              <p className="text-secondary text-sm mt-2">{card.blurb}</p>
            </button>
          </form>
        ))}
      </div>
    </main>
  )
}
