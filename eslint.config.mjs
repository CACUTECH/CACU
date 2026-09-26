import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [".next/**", "node_modules/**", "next-env.d.ts", "jest.config.js"],
  },
  {
    rules: {
      // Pre-existing `any` usages throughout the app (Supabase untyped client,
      // recharts config objects, generic form/event handlers). Tracked as
      // technical debt, not silenced, not allowed to block CI as an error.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
];

export default eslintConfig;
