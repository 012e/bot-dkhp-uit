import { chromium, devices, Page } from "playwright";
import { DKHPConfig, defaultConfig } from "./config";

const userConfig: DKHPConfig = require("../dkhp.config.json");
const config = { ...defaultConfig, ...userConfig };
const INTERUPT_INTERVAL: number = 3 * 60 * 1000;

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function registerClass(page: Page, className: string): Promise<boolean> {
  const ele = page
    .getByRole("table")
    .locator("tr")
    .filter({ has: page.locator("td").getByText(className, { exact: true }) })
    .getByRole("checkbox");
  if (await ele.isDisabled()) return false;
  await ele.check();
  return true;
}

async function confirmRegistration(page: Page): Promise<void> {
  await page.getByRole("button").getByText("Đăng ký").click();
  await page.waitForResponse((res) => {
    return (
      res.url() === "https://dkhpapi.uit.edu.vn/courses-waiting-processing"
    );
  });
}

async function reloadInIntervalsUntil(
  page: Page,
  interval: number,
  time: Date
) {
  let diff = time.valueOf() - Date.now().valueOf();
  if (diff < 0) return;
  let totalInterval = Math.trunc(diff / INTERUPT_INTERVAL);
  const remaining = diff % INTERUPT_INTERVAL;
  for (let i = 0; i < totalInterval; ++i) {
    console.log(`waiting... (interval number ${i + 1}/${totalInterval})`);
    await delay(INTERUPT_INTERVAL);
    page.reload();
  }
  console.log(`sleeping for ${remaining}ms`);
  await delay(remaining + 100); // exact time could cause some problems
  page.reload();
}

async function main() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext(devices["iPhone 11"]);
  const page = await context.newPage();
  let classes = config.classes;

  await page.goto("https://dkhp.uit.edu.vn");
  await page.getByLabel("Mã sinh viên").fill(config.username);
  await page.getByLabel("Mật khẩu").fill(config.password);
  await page.getByRole("button").getByText("Đăng nhập").click();
  await page.waitForLoadState("networkidle");
  await page.goto("https://dkhp.uit.edu.vn/app/reg");
  await page.waitForResponse(
    (res) => res.url() === "https://dkhpapi.uit.edu.vn/courses"
  );
  await delay(1500);
  if (userConfig.timer ?? false) {
    if (!config.startTime)
      throw new Error("configuration error: startTime is not provided");
    const beginTime = new Date(config.startTime);
    await reloadInIntervalsUntil(page, INTERUPT_INTERVAL, beginTime); // avoid cookie timeouts
  }

  while (classes.length > 0) {
    try {
      console.log(`${classes.length} classes remaining`);
      let ok = false;
      for (const sub of classes) {
        console.log(`registering ${sub}`);
        if (await registerClass(page, sub)) {
          ok = true;
          console.log(`registered ${sub} successfully`);
          classes = classes.filter((c) => c !== sub);
        } else {
          console.log(`couldn't register ${sub}`);
        }
      }
      if (ok) {
        console.log("confirming registration");
        await confirmRegistration(page);
      }
    } catch (e) {
      console.log(e);
      console.log("failed to register, retrying");
    }
    console.log("continuing next try");
    await delay(3000);
    await page.reload();
    await page.waitForResponse(
      (res) => res.url() === "https://dkhpapi.uit.edu.vn/courses"
    );
    await delay(1000);
  }
  console.log("All classes registered successfully!");
  await browser.close();
}

main();