import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist", "**/coverage"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      parser: tseslint.parser,
      parserOptions: {
        project: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      quotes: ["warn", "double", { avoidEscape: true }],
      curly: ["warn", "all"],
      "no-useless-concat": "warn",
      "@typescript-eslint/no-shadow": "warn",
      "@typescript-eslint/no-deprecated": "warn",
      "no-empty": "warn",
      "prefer-const": "warn",
      "no-console": "warn",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-floating-promises": "warn",
      "@typescript-eslint/require-await": "warn",
      "@typescript-eslint/await-thenable": "warn",
      "@typescript-eslint/no-unused-vars": "warn",
      "@typescript-eslint/switch-exhaustiveness-check": "warn",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unused-expressions": [
        "error",
        {
          allowShortCircuit: true,
          allowTernary: true,
        },
      ],
    },
  },
  {
    files: ["**/*.mjs"],
    rules: {
      quotes: ["warn", "double", { avoidEscape: true }],
      curly: ["warn", "all"],
      "no-useless-concat": "warn",
      "no-shadow": "warn",
      "no-empty": "warn",
      "prefer-const": "warn",
    },
  },
);
