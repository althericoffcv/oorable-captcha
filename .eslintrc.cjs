/** ESLint flat-config note: this repo targets ESLint 9. See docs/testing.md
 * for the exact `eslint.config.js` used once dependencies are installed --
 * this .cjs file is kept as a legacy-compatible fallback config. */
module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: { sourceType: "module", ecmaVersion: 2022 },
  plugins: ["@typescript-eslint"],
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
  env: { node: true, es2022: true },
  rules: {
    "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    "no-console": "off"
  },
  ignorePatterns: ["dist/", "node_modules/"]
};
