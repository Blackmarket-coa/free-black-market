/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Forest greens (solarpunk — matched to vendor-panel tokens)
        forest: {
          50: "#e8faf0",
          100: "#d1f5dc",
          200: "#a7e8bc",
          300: "#78da9a",
          400: "#48bb78",
          500: "#34a362",
          600: "#268751",
          700: "#206c3f",
          800: "#1a5a35",
          900: "#164429",
        },
        amber: {
          50: "#fff8f0",
          100: "#ffefdc",
          200: "#ffdca8",
          300: "#ffc870",
          400: "#f5b432",
          500: "#dc9b28",
          600: "#be7d1e",
          700: "#9b5f14",
          800: "#7a4a10",
          900: "#55310a",
        },
        cream: {
          50: "#fffdfA",
          100: "#faf7f1",
          200: "#f4f0e7",
          300: "#ebe5d9",
          400: "#d6cebe",
          500: "#b4aa98",
          600: "#8c8270",
          700: "#645c4c",
          800: "#373228",
          900: "#181610",
        },
        clay: "#C4622D",
        leaf: "#7EC850",
        // Dark surfaces from the broader BMC palette
        bark: "#1a1f0f",
        moss: "#242b14",
        soil: "#0f1409",
        mist: "#a8b89a",
        ghost: "#5a6b52",
      },
      fontFamily: {
        sans: ["IBM Plex Sans", "system-ui", "sans-serif"],
        display: ["Archivo Black", "system-ui", "sans-serif"],
      },
      boxShadow: {
        "solarpunk-sm": "0 2px 8px rgba(22, 68, 41, 0.08)",
        "solarpunk-md": "0 4px 16px rgba(22, 68, 41, 0.12)",
        "forest-glow": "0 0 20px rgba(72, 187, 120, 0.3)",
      },
      borderRadius: {
        xs: "4px",
        sm: "8px",
        md: "12px",
        lg: "16px",
      },
    },
  },
  plugins: [],
}
