import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        kiosk: {
          blue: "#0ea5e9",
          green: "#22c55e",
          red: "#ef4444",
          amber: "#f59e0b",
        },
      },
    },
  },
  plugins: [],
};

export default config;
