import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
	globalIgnores(["dist", "node_modules", "build", "coverage"]),
	{
		files: ["**/*.{ts,js}"],
		extends: [
			js.configs.recommended,
			tseslint.configs.recommended,
		],
		languageOptions: {
			ecmaVersion: 2020,
			sourceType: "module",
			globals: {
				...globals.node,
				...globals.es2020,
			},
			parserOptions: {
				project: "./tsconfig.json",
			},
		},
		rules: {
			"semi": ["error", "always"],
			"quotes": ["error", "double", { avoidEscape: true, allowTemplateLiterals: true }],
			"indent": ["error", "tab"],
			"object-curly-spacing": ["error", "always"],

			"@typescript-eslint/no-explicit-any": "warn",
			"@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],

			"no-console": "off",
			"global-require": "off",
			"no-process-exit": "off",
		},
	},
]);