import { test, expect } from "./fixtures";

test("navigation icons and user badge remain visible with a scrolling account list", async ({
  page,
  finance,
}) => {
  finance.accounts.push(
    ...Array.from({ length: 30 }, (_, i) => ({
      ...finance.accounts[0],
      id: `extra-${i}`,
      name: `Account ${i}`,
    })),
  );
  await page.goto("/");
  await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
  const toggle = page.getByRole("button", { name: "Toggle navigation" });
  if (await toggle.isVisible()) await toggle.click();
  const nav = page.getByRole("navigation");
  await expect(
    nav.getByRole("link", { name: "Home", exact: true }).locator("svg"),
  ).toHaveClass(/tabler-icon-layout-dashboard/);
  await expect(
    nav.getByRole("link", { name: "Budget", exact: true }).locator("svg"),
  ).toHaveClass(/tabler-icon-report-money/);
  const avatar = nav.getByRole("img", {
    name: "Signed in as owner@example.test",
  });
  await expect(avatar).toHaveText("OW");
  await expect(avatar).toBeInViewport();
  await nav
    .getByRole("link", { name: "Settings", exact: true })
    .scrollIntoViewIfNeeded();
  await expect(avatar).toBeInViewport();
  const navBox = await nav.boundingBox();
  const avatarBox = await avatar.boundingBox();
  expect(avatarBox!.y).toBeGreaterThan(navBox!.y + navBox!.height - 140);
  const collapse = page.getByRole("button", { name: "Collapse navigation" });
  if (await collapse.isVisible()) {
    await collapse.click();
    await expect(avatar).toBeInViewport();
    await expect(avatar).toHaveText("OW");
  }
});
