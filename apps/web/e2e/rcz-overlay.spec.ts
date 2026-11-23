import { test, expect } from "@playwright/test";
import type { components } from "@cortex/contracts";

test("exports measured speed from a partial lap with GPS absent", async ({
  page,
}) => {
  const response: components["schemas"]["RczSession"] = {
    start: 1000,
    end: 3500,
    channels: [
      {
        id: "speedKmh",
        label: "Speed",
        valueType: "continuous",
        unit: "km/h",
        origin: "source",
        suggestedView: "line",
      },
    ],
    laps: [
      {
        number: 1,
        startTimestamp: 1000,
        finishTimestamp: null,
        isInvalid: false,
      },
    ],
    samples: [1000, 2000, 3500].map((timestamp, i) => ({
      timestamp,
      time: (timestamp - 1000) / 1000,
      lapNumber: 1,
      lapTime: (timestamp - 1000) / 1000,
      distance: null,
      values: { speedKmh: i === 0 ? 0 : null },
    })),
  };
  await page.route("**/api/telemetry/rcz", async (route) => {
    expect(route.request().method()).toBe("POST");
    await route.fulfill({ json: response });
  });
  await page.goto("/telemetry/overlays");
  await page
    .getByLabel("Selecionar arquivo RCZ")
    .setInputFiles({
      name: "controlled.rcz",
      mimeType: "application/octet-stream",
      buffer: Buffer.from("controlled input"),
    });
  await expect(
    page.getByRole("checkbox", { name: "Velocidade", exact: true }),
  ).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: "Mapa", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("combobox", { name: /Exportar/ }).selectOption("1");
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Baixar CSV" }).click();
  const download = await pending;
  const stream = await download.createReadStream();
  const rows: Buffer[] = [];
  for await (const row of stream!) rows.push(Buffer.from(row));
  expect(Buffer.concat(rows).toString()).toBe(
    "timestamp,speedKmh\r\n1000,0\r\n2000,\r\n3500,",
  );
  await page.reload();
  await expect(page.getByRole("button", { name: "Baixar CSV" })).toHaveCount(0);
});
