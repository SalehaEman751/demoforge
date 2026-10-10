import type { Config } from "tailwindcss";
import colors from "tailwindcss/colors";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // The one accent color. Everything highlighted in the UI uses `accent-*`, so changing
      // this line re-colors the whole app. Red is kept only for errors and setup problems.
      colors: { accent: colors.teal },
    },
  },
  plugins: [],
};
export default config;
