import { expect, test } from "@playwright/test";

test("home page loads with Persian RTL layout", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("html")).toHaveAttribute("lang", "fa");
  await expect(page.getByRole("heading", { name: "پرزبوی" })).toBeVisible();
});
