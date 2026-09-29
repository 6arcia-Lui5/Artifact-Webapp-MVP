import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 60000,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://localhost:5173",
    channel: "msedge",
    trace: "off",
    screenshot: "off",
    video: "off",
  },
});

