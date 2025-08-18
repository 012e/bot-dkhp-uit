import { chromium, devices, Page, Browser, BrowserContext } from "playwright";
import { z } from "zod";
import fs from "fs";

// Zod schema for config validation
const DKHPConfigSchema = z
  .object({
    username: z.string().min(1, "Username is required"),
    password: z.string().min(1, "Password is required"),
    classes: z
      .array(z.string().min(1))
      .min(1, "At least one class is required"),
    loginTries: z.number().int().positive().default(10),
    retryDelay: z.number().positive().default(5000),
    timer: z.boolean().optional(),
    startTime: z.iso.datetime().optional(),
  })
  .refine((data) => !data.timer || data.startTime, {
    message: "startTime is required when timer is enabled",
    path: ["startTime"],
  });

type DKHPConfig = z.infer<typeof DKHPConfigSchema>;

const defaultConfig: Partial<DKHPConfig> = {
  loginTries: 10,
  retryDelay: 5000,
  timer: false,
};

const INTERRUPT_INTERVAL = 3 * 60 * 1000; // 3 minutes
const CONFIG_FILE = "dkhp.config.json";

class DKHPRegistration {
  private config: DKHPConfig;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;

  constructor() {
    this.config = this.loadAndValidateConfig();
  }

  private loadAndValidateConfig(): DKHPConfig {
    try {
      let userConfig = {};

      if (fs.existsSync(CONFIG_FILE)) {
        const configStr = fs.readFileSync(CONFIG_FILE, "utf-8");
        try {
          userConfig = JSON.parse(configStr);
        } catch (error) {
          console.error(
            `Invalid JSON in config file (${CONFIG_FILE}): ${error instanceof Error ? error.message : error}`,
          );
          process.exit(1);
        }
      } else {
        console.warn(
          `Config file (${CONFIG_FILE}) not found, using defaults where possible`,
        );
      }

      const mergedConfig = { ...defaultConfig, ...userConfig };
      const result = DKHPConfigSchema.safeParse(mergedConfig);

      if (!result.success) {
        console.error("Configuration validation failed:");
        console.log(z.prettifyError(result.error));
        process.exit(1);
      }

      return result.data;
    } catch (error) {
      console.error(
        `Failed to load config file (${CONFIG_FILE}): ${error instanceof Error ? error.message : error}`,
      );
      process.exit(1);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async registerClass(className: string): Promise<boolean> {
    if (!this.page) throw new Error("Page not initialized");

    const ele = this.page
      .getByRole("table")
      .locator("tr")
      .filter({
        has: this.page.locator("td").getByText(className, { exact: true }),
      })
      .getByRole("checkbox");

    try {
      if (await ele.isDisabled({ timeout: 1000 })) {
        return false;
      }
      await ele.check();
      return true;
    } catch (error) {
      console.log(`Error registering class ${className}:`, error);
      return false;
    }
  }

  private async confirmRegistration(): Promise<void> {
    if (!this.page) throw new Error("Page not initialized");

    await this.page.getByRole("button").getByText("Đăng ký").click();
    await this.page.waitForResponse(
      (res) =>
        res.url() === "https://dkhpapi.uit.edu.vn/courses-waiting-processing",
    );
  }

  private async reloadInIntervalsUntil(targetTime: Date): Promise<void> {
    if (!this.page) throw new Error("Page not initialized");

    let diff = targetTime.valueOf() - Date.now();
    if (diff < 0) return;

    while (diff > INTERRUPT_INTERVAL) {
      console.log(`${Math.round(diff / 1000)}s left`);
      await this.delay(INTERRUPT_INTERVAL);

      const startTime = performance.now();
      await this.page.reload();
      const endTime = performance.now();

      diff -= endTime - startTime + INTERRUPT_INTERVAL;
    }

    if (diff > 0) {
      console.log(`Final wait: ${Math.round(diff / 1000)}s`);
      await this.delay(diff + 100); // Small buffer to avoid timing issues
    }

    await this.page.reload();
  }

  private async waitForCourses(): Promise<void> {
    if (!this.page) throw new Error("Page not initialized");

    await this.page.waitForResponse(
      (res) => res.url() === "https://dkhpapi.uit.edu.vn/courses",
      { timeout: 10000 },
    );
    console.log("Registration page loaded");
  }

  private async login(): Promise<void> {
    if (!this.page) throw new Error("Page not initialized");

    if (this.page.url() === "https://dkhp.uit.edu.vn/app") {
      console.log("Already logged in");
      return;
    }

    await this.page.goto("https://dkhp.uit.edu.vn", { timeout: 10000 });

    await this.page.getByLabel("Mã sinh viên").fill(this.config.username);
    await this.page.getByLabel("Mật khẩu").fill(this.config.password);
    await this.page.getByRole("button").getByText("Đăng nhập").click();

    await this.page.waitForLoadState("networkidle", { timeout: 15000 });

    if (this.page.url() !== "https://dkhp.uit.edu.vn/app") {
      throw new Error(
        "Login failed - incorrect credentials or page navigation failed",
      );
    }
  }

  private async initializeBrowser(): Promise<void> {
    this.browser = await chromium.launch({ headless: false });
    this.context = await this.browser.newContext(devices["iPhone 11"]);
    this.page = await this.context.newPage();
  }

  private async attemptLogin(): Promise<boolean> {
    for (let attempt = 1; attempt <= this.config.loginTries; attempt++) {
      try {
        console.log(`Login attempt ${attempt}/${this.config.loginTries}`);
        await this.login();
        console.log("Login successful");
        return true;
      } catch (error) {
        console.error(`Login attempt ${attempt} failed:`, error);
        if (attempt < this.config.loginTries) {
          await this.delay(this.config.retryDelay);
        }
      }
    }
    return false;
  }

  private async waitForStartTime(): Promise<void> {
    if (!this.config.timer || !this.config.startTime) return;

    const startTime = new Date(this.config.startTime);
    console.log(`Timer enabled. Waiting until: ${startTime.toISOString()}`);
    await this.reloadInIntervalsUntil(startTime);
  }

  private async attemptRegistration(): Promise<boolean> {
    let anySuccess = false;

    for (const className of this.config.classes) {
      console.log(`Attempting to register: ${className.trim()}`);

      if (await this.registerClass(className.trim())) {
        console.log(`✓ Successfully registered: ${className}`);
        anySuccess = true;
      } else {
        console.log(`✗ Could not register: ${className}`);
      }
    }

    if (anySuccess) {
      console.log("Confirming registration...");
      await this.confirmRegistration();
      console.log("Registration confirmed");
      return true;
    }

    return false;
  }

  private async registrationLoop(): Promise<void> {
    if (!this.page) throw new Error("Page not initialized");

    while (true) {
      try {
        await this.waitForCourses();
        break;
      } catch (error) {
        console.error("Failed to load courses:", error);
        console.log("Retrying...");
        await this.delay(this.config.retryDelay);
        await this.page.reload();
      }
    }

    console.log("Starting registration loop...");

    while (true) {
      try {
        const success = await this.attemptRegistration();

        if (success) {
          console.log("Registration completed successfully!");
          // Continue monitoring in case of failures
        }

        console.log("Waiting before next attempt...");
        await this.delay(3000);
        await this.page.reload();
        await this.waitForCourses();
        await this.delay(this.config.retryDelay);
      } catch (error) {
        console.error("Registration attempt failed:", error);
        await this.delay(this.config.retryDelay);
      }
    }
  }

  async run(): Promise<void> {
    try {
      console.log("Initializing browser...");
      await this.initializeBrowser();

      const loginSuccess = await this.attemptLogin();
      if (!loginSuccess) {
        throw new Error(
          `Failed to login after ${this.config.loginTries} attempts`,
        );
      }

      console.log("Navigating to registration page...");
      await this.page!.goto("https://dkhp.uit.edu.vn/app/reg");
      await this.delay(1500);

      await this.waitForStartTime();
      await this.registrationLoop();
    } catch (error) {
      console.error("Fatal error in main execution:", error);
      throw error;
    }
  }

  async cleanup(): Promise<void> {
    try {
      await this.context?.close();
      await this.browser?.close();
    } catch (error) {
      console.error("Error during cleanup:", error);
    }
  }
}

async function main(): Promise<void> {
  const registration = new DKHPRegistration();

  try {
    await registration.run();
  } finally {
    await registration.cleanup();
  }
}

async function mainWrapper(): Promise<void> {
  while (true) {
    try {
      await main();
      console.log("Main execution completed successfully");
      return;
    } catch (error) {
      console.error("Main execution failed:", error);
      console.log("Restarting in 10 seconds...");
      await new Promise((resolve) => setTimeout(resolve, 10000));
    }
  }
}

// Start the application
console.log("DKHP Registration Bot Starting...");
mainWrapper().catch(console.error);
