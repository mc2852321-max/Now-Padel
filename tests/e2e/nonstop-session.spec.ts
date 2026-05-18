import { expect, test } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5055";
const credentials = {
  email: "admin@nowpadel.local",
  password: "admin123",
};

async function login(page: import("@playwright/test").Page) {
  await page.goto(`${baseURL}/`);
  await page.getByTestId("input-email").fill(credentials.email);
  await page.getByTestId("input-password").fill(credentials.password);
  await page.getByTestId("button-login").click();
  await expect(page.getByTestId("button-user-menu")).toBeVisible();
}

async function seedNonstop(page: import("@playwright/test").Page) {
  await page.request.post(`${baseURL}/api/nonstop/reset`);

  const teamIds: number[] = [];
  for (let i = 1; i <= 6; i += 1) {
    const response = await page.request.post(`${baseURL}/api/teams`, {
      data: {
        name: `E2E Dupla ${i}`,
        playerAId: 1,
        playerBId: 2,
      },
    });
    expect(response.status()).toBe(201);
    const team = await response.json();
    teamIds.push(team.id);
  }

  const resultResponse = await page.request.post(`${baseURL}/api/results`, {
    data: {
      round: 1,
      court: 1,
      teamAId: teamIds[0],
      teamBId: teamIds[1],
      scoreA: 1,
      scoreB: 1,
    },
  });
  expect(resultResponse.status()).toBe(201);

  const timerResponse = await page.request.post(`${baseURL}/api/nonstop/timer`, {
    data: {
      timerState: "game",
      isActive: true,
      round: 1,
      timeLeft: 600,
      phaseEndsAt: new Date(Date.now() + 600_000).toISOString(),
    },
  });
  expect(timerResponse.status()).toBe(200);
}

test("Non Stop keeps timer visible and saves pending scores across session expiry", async ({ page }) => {
  await login(page);
  await seedNonstop(page);

  await page.goto(`${baseURL}/nonstop`);
  await expect(page.getByText("Em Jogo")).toBeVisible();

  const timer = page.locator("span.font-mono.tabular-nums").first();
  await expect(timer).toBeVisible();
  const beforeExpiryTimer = await timer.innerText();
  expect(beforeExpiryTimer).toMatch(/^\d+:\d{2}$/);

  const scoreInputs = page.locator('input[inputmode="numeric"]');
  await expect(scoreInputs.first()).toHaveValue("1");

  const logoutResponse = await page.request.post(`${baseURL}/api/auth/logout`);
  expect(logoutResponse.status()).toBe(200);

  await scoreInputs.first().fill("8");
  await scoreInputs.first().blur();

  await expect(page.getByRole("button", { name: "Retomar sessão" })).toBeVisible();
  await expect(page.getByText("O cronómetro continua no ecrã.")).toBeVisible();
  await expect(timer).toBeVisible();

  await page.waitForTimeout(1500);
  const afterExpiryTimer = await timer.innerText();
  expect(afterExpiryTimer).toMatch(/^\d+:\d{2}$/);
  expect(afterExpiryTimer).not.toBe(beforeExpiryTimer);

  const pendingRaw = await page.evaluate(() => window.localStorage.getItem("now-padel:nonstop:pending-results"));
  expect(pendingRaw).toContain('"scoreA":8');

  await page.getByPlaceholder("Email").fill(credentials.email);
  await page.getByPlaceholder("Password").fill(credentials.password);
  await page.getByRole("button", { name: "Retomar sessão" }).click();
  await expect(page.getByRole("button", { name: "Retomar sessão" })).toBeHidden();

  await expect
    .poll(async () => {
      const response = await page.request.get(`${baseURL}/api/results`);
      if (response.status() !== 200) return null;
      const rows = await response.json();
      const row = rows.find((item: any) => item.round === 1 && item.court === 1);
      return row ? `${row.scoreA}-${row.scoreB}` : null;
    })
    .toBe("8-1");

  await expect
    .poll(async () => page.evaluate(() => window.localStorage.getItem("now-padel:nonstop:pending-results")))
    .toBeNull();
});

test("score drafts survive reload before blur", async ({ page }) => {
  await login(page);
  await seedNonstop(page);

  await page.goto(`${baseURL}/nonstop`);
  const scoreInputs = page.locator('input[inputmode="numeric"]');
  await expect(scoreInputs.nth(1)).toHaveValue("1");

  await scoreInputs.nth(1).fill("9");
  await page.reload();
  await expect(page.locator('input[inputmode="numeric"]').nth(1)).toHaveValue("9");
});
