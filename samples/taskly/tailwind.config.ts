import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // The one accent color.
        accent: { DEFAULT: "#0d9488", dark: "#0f766e", soft: "#f0fdfa" },
      },
    },
  },
  plugins: [],
};
export default config;
