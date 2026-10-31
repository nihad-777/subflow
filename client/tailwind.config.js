/** @type {import('tailwindcss').Config} */
export default {
 content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
 // Finance pages use indigo classes; mapped to Subflow's green.
 theme: { extend: { colors: { indigo: { 50: '#edf6f0', 100: '#dcefe3', 500: '#3c7357', 600: '#176b50', 700: '#10583f' } } } },
}

