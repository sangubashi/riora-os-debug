import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  timeout: 60000,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"], ["json", { outputFile: "pw-results.json" }]],
  use: {
    baseURL: "https://riora-os-debug-webhook.vercel.app",
    trace: "off",
    screenshot: "on",
  },
  projects: [{
    name: "chromium",
    use: {
      ...devices["Desktop Chrome"],
      viewport: { width: 390, height: 844 },
    },
  }],
});
