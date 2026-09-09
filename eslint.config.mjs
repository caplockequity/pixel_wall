import { defineConfig, globalIgnores } from "eslint/config";
import eslint from "@eslint/js";
import next from "@next/eslint-plugin-next";
import jsxA11y from "eslint-plugin-jsx-a11y";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

const eslintConfig = defineConfig([
  globalIgnores([
    ".next/**",
    "dist/**",
    "out/**",
    "build/**",
    "desktop/app/**",
    "desktop/release/**",
    "work/**",
    "outputs/**",
    "public/runtimes/**",
    "next-env.d.ts",
  ]),
  { files: ["**/*.jsx"] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  react.configs.flat.recommended,
  react.configs.flat["jsx-runtime"],
  reactHooks.configs.flat["recommended-latest"],
  jsxA11y.flatConfigs.recommended,
  next.configs["core-web-vitals"],
  {
    files: ["app/(public)/**/*.tsx", "app/studio.tsx", "app/workbench.jsx"],
    rules: {
      // Document navigation prevents editor prefetch and unloads its optional recorder.
      "@next/next/no-html-link-for-pages": "off",
    },
  },
  { files:["app/workbench.jsx"], rules:{
    // The canvas application handles editor shortcuts; command output must be keyboard-scrollable.
    "jsx-a11y/no-noninteractive-element-interactions":["error",{div:["onKeyDown"]}],
    "jsx-a11y/no-noninteractive-tabindex":["error",{tags:["pre"]}]
  }},
  {
    files: ["app/(public)/document.tsx"],
    rules: {
      // Code samples can overflow horizontally and must be keyboard-scrollable.
      "jsx-a11y/no-noninteractive-tabindex": ["error", { tags: ["pre"] }],
    },
  },
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.serviceworker,
      },
    },
    settings: {
      react: {
        version: "detect",
      },
    },
  },
]);

export default eslintConfig;
