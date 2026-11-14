import type { Config } from "tailwindcss";

/**
 * Paron design tokens (see DESIGN.md). One accent (primary) for actions and the forward-curve line;
 * up/down/warn are semantic text colours only. Every text pair meets WCAG AA (checked with the
 * antislop contrast checker): body 6.2:1, muted 5.0:1, primary 6.0:1, up 5.4:1, down 5.7:1, warn 5.9:1.
 */
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#FFFFFF",
        soft: "#F5F6F8",
        strong: "#EEF0F3",
        hairline: { DEFAULT: "#DEE1E6", strong: "#8C929C" },
        ink: "#0A0B0D",
        body: "#5B616E",
        muted: "#6B7079",
        primary: { DEFAULT: "#1652F0", hover: "#0F41C7", soft: "#EEF3FF" },
        up: { DEFAULT: "#047A4A", soft: "#E8F5EE" },
        down: { DEFAULT: "#C8202F", soft: "#FCECEE" },
        warn: { DEFAULT: "#8A5A00", soft: "#FFF5E0" },
        night: { DEFAULT: "#0A0B0D", raised: "#16181C", line: "#2A2D33", text: "#FFFFFF", soft: "#A8ACB3", muted: "#8B919C", accent: "#7FA4FF", up: "#4ADE80", down: "#F87171" },
      },
      fontFamily: {
        sans: ["'Inter Variable'", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica", "Arial", "sans-serif"],
        mono: ["'JetBrains Mono Variable'", "ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      fontSize: {
        "display-xl": ["4rem", { lineHeight: "1.02", letterSpacing: "-0.025em", fontWeight: "400" }],
        "display-lg": ["3.25rem", { lineHeight: "1.04", letterSpacing: "-0.024em", fontWeight: "400" }],
        "display-md": ["2.5rem", { lineHeight: "1.1", letterSpacing: "-0.022em", fontWeight: "400" }],
        "display-sm": ["2rem", { lineHeight: "1.13", letterSpacing: "-0.015em", fontWeight: "400" }],
      },
      borderRadius: {
        card: "24px",
        panel: "16px",
        field: "12px",
      },
      boxShadow: {
        lift: "0 4px 12px rgba(10, 11, 13, 0.06)",
        sheet: "0 24px 48px -12px rgba(10, 11, 13, 0.28)",
      },
      transitionTimingFunction: {
        "out-expo": "cubic-bezier(0.16, 1, 0.3, 1)",
      },
      keyframes: {
        "sheet-in": { from: { opacity: "0", transform: "translateY(8px) scale(0.985)" }, to: { opacity: "1", transform: "none" } },
        "fade": { from: { opacity: "0" }, to: { opacity: "1" } },
        "slide-in-left": { from: { transform: "translateX(-100%)" }, to: { transform: "none" } },
      },
      animation: {
        "sheet-in": "sheet-in 0.32s cubic-bezier(0.16, 1, 0.3, 1) both",
        fade: "fade 0.2s ease-out both",
        "slide-in-left": "slide-in-left 0.28s cubic-bezier(0.16, 1, 0.3, 1) both",
      },
    },
  },
  plugins: [],
} satisfies Config;
