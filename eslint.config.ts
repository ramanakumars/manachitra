import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
    { ignores: ["dist/", "coverage/", "node_modules/", "public/"] },
    js.configs.recommended,
    tseslint.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: "module",
            globals: globals.browser,
        },
        rules: {
            "no-var": "error",
            "prefer-const": "error",
            eqeqeq: ["error", "always"],
            "@typescript-eslint/no-unused-vars": [
                "error",
                { args: "after-used" },
            ],
            "@typescript-eslint/consistent-type-imports": "error",
        },
    },
    {
        files: ["*.config.ts"],
        languageOptions: { globals: globals.node },
    },
);
