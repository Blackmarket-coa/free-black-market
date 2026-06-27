// Rough emoji mapping by species keyword. Purely decorative; falls back to a
// generic seedling.
const RULES: [RegExp, string][] = [
  [/fig/i, "🪴"],
  [/banana/i, "🍌"],
  [/elder/i, "🫐"],
  [/beautyberry/i, "🟣"],
  [/rosemary|herb/i, "🌿"],
  [/guava/i, "🍈"],
  [/mulberry|berry/i, "🫐"],
  [/lychee/i, "🔴"],
  [/persimmon/i, "🟠"],
  [/pawpaw/i, "🥭"],
  [/potato/i, "🍠"],
]

export function speciesEmoji(name: string): string {
  for (const [re, emoji] of RULES) if (re.test(name)) return emoji
  return "🌱"
}

export function SpeciesIcon({ name }: { name: string }) {
  return (
    <span aria-hidden className="inline-block w-5 text-center">
      {speciesEmoji(name)}
    </span>
  )
}
