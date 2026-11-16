import { defineConfig } from "vitest/config";

// Separate from Vite's dev/build config (there is none), so tests can't
// change how the app is served or bundled.
export default defineConfig({
    test: {
        include: ["test/**/*.test.ts"],
        environment: "node", // DOM tests opt in with @vitest-environment jsdom
        coverage: {
            provider: "v8",
            include: ["src/**/*.ts"],
            reporter: ["text", "html"],
        },
    },
});
