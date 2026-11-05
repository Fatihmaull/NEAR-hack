import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#04060a",
          900: "#080b11",
          850: "#0b0f17",
          800: "#0f141e",
          700: "#151c29",
          600: "#1d2636",
          500: "#2a3549",
          400: "#3a475e",
        },
        fg: { DEFAULT: "#e6ebf2", muted: "#98a3b6", dim: "#5f6b80" },
        near: { DEFAULT: "#2ee6a6", deep: "#0fb57f" },
        tee: "#4cc3ff",
        intents: "#a78bfa",
        warn: "#f5b84a",
        danger: "#ff5d73",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "Liberation Mono", "monospace"],
      },
      boxShadow: {
        panel: "0 0 0 1px rgba(255,255,255,0.02), 0 12px 40px -16px rgba(0,0,0,0.65)",
        glow: "0 0 0 1px rgba(46,230,166,0.35), 0 0 32px -8px rgba(46,230,166,0.45)",
      },
      keyframes: {
        "fade-in": { from: { opacity: "0", transform: "translateY(4px)" }, to: { opacity: "1", transform: "translateY(0)" } },
        pulseDot: { "0%,100%": { opacity: "1" }, "50%": { opacity: "0.35" } },
      },
      animation: {
        "fade-in": "fade-in 0.35s ease-out both",
        "pulse-dot": "pulseDot 1.6s ease-in-out infinite",
      },
    },
  },
  plugins: [],
} satisfies Config;
