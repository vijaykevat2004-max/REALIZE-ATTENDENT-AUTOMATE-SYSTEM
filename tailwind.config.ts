import type { Config } from "tailwindcss";
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        navy: { DEFAULT: "#0A2342", light: "#133257", dark: "#081A33" },
        orange: { DEFAULT: "#F08A24", hover: "#d97a1a" },
        ice: "#EAF2FA",
        success: "#10B981",
        danger: "#EF4444",
        warning: "#F59E0B",
        info: "#3B82F6",
      },
      animation: {
        "fade-in": "fadeIn 0.3s ease-out",
        "slide-in": "slideIn 0.2s ease-out",
      },
      keyframes: {
        fadeIn: { "0%": { opacity: "0", transform: "translateY(8px)" }, "100%": { opacity: "1", transform: "translateY(0)" } },
        slideIn: { "0%": { transform: "translateX(-100%)" }, "100%": { transform: "translateX(0)" } },
      },
    },
  },
  plugins: [],
} satisfies Config;
