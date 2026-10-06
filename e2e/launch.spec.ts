import { expect, launch, test } from "./fixtures";

test("the launch URL signs in and drops the token from the address bar", async ({ page, specquer }) => {
  await launch(page, specquer);
  expect(page.url()).toBe(`${specquer.origin}/`);
  // The session cookie keeps working after a reload
  await page.reload();
  await expect(page.getByRole("tree", { name: "Files" })).toBeVisible();
});

test("without the token, Specquer refuses the page and the API", async ({ page, specquer }) => {
  const response = await page.goto(specquer.origin);
  expect(response?.status()).toBe(401);
  await expect(page.getByText("This session isn't signed in")).toBeVisible();
  const api = await page.request.get(`${specquer.origin}/api/tree`);
  expect(api.status()).toBe(401);
  const wrong = await page.goto(`${specquer.origin}/?token=wrong`);
  expect(wrong?.status()).toBe(401);
});

test("the page has a Content-Security-Policy", async ({ page, specquer }) => {
  await launch(page, specquer);
  const response = await page.request.get(`${specquer.origin}/`);
  expect(response.headers()["content-security-policy"]).toContain("script-src 'self'");
});
