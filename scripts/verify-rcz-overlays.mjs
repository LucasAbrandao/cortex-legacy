import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { basename } from "node:path";
import { readFile } from "node:fs/promises";
const files = process.argv.slice(2);
if (!files.length)
  throw Error("Pass local RCZ files as command-line arguments.");
const base = process.env.CORTEX_WEB_URL ?? "http://127.0.0.1:3000";
(async () => {
  const b = await chromium.launch({ channel: "chrome" });
  try {
    const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
    const pageErrors = [];
    p.on("pageerror", (e) => pageErrors.push(e.message));
    await p.goto(base + "/telemetry");
    await p
      .getByRole("link", { name: "Estúdio de overlays RCZ", exact: true })
      .click();
    await p.waitForURL("**/telemetry/overlays");
    await p.evaluate(() => {
      const fetch0 = window.fetch;
      window.fetch = async (...args) => {
        const response = await fetch0(...args);
        if (response.url.endsWith("/telemetry/rcz"))
          window.normalized = await response.clone().json();
        return response;
      };
    });
    for (const path of files) {
      const file = basename(path);
      const response = p.waitForResponse(
        (r) =>
          r.url().endsWith("/telemetry/rcz") && r.request().method() === "POST",
      );
      await p.locator("input[type=file]").setInputFiles(path);
      await response;
      await p.waitForFunction(() => window.normalized);
      const data = await p.evaluate(() => {
        const data = window.normalized;
        window.normalized = null;
        return {
          start: data.start,
          end: data.end,
          laps: data.laps,
          channels: data.channels.map((c) => c.id),
        };
      });
      const count = data.laps.filter((l) => l.finishTimestamp != null).length;
      await p
        .getByRole("combobox", { name: /^Exportar/ })
        .selectOption("custom");
      const start = (data.laps[0].startTimestamp - data.start) / 1000 + 8;
      await p.getByLabel("Início (s)").fill(String(start));
      await p.getByLabel("Fim (s)").fill(String(start + 3));
      for (const width of [1440, 1200, 1024, 390]) {
        await p.setViewportSize({ width, height: 900 });
        assert.ok(
          await p.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          "overflow " + width,
        );
      }
      await p.setViewportSize({ width: 1440, height: 900 });
      const observed = {};
      for (const map of [false, true]) {
        await p
          .getByRole("checkbox", { name: "Mapa", exact: true })
          .setChecked(map);
        const [artifact] = await Promise.all([
          p.waitForEvent("download", {timeout:180_000}),
          p.getByRole("button",{name:"Baixar WebM"}).click(),
        ]);
        assert.equal(artifact.suggestedFilename(), "cortex-overlay.webm");
        const bytes = await readFile(await artifact.path());
        const meta = await p.evaluate(async (encoded) => {
          const decoded = Uint8Array.from(atob(encoded), (c) =>
            c.charCodeAt(0),
          );
          const reopened = new Blob([decoded], { type: "video/webm" });
          const v = document.createElement("video");
          v.muted = true;
          v.src = URL.createObjectURL(reopened);
          await new Promise((ok, no) => {
            v.onloadedmetadata = ok;
            v.onerror = no;
          });
          window.testVideo = v;
          return {
            duration: v.duration,
            bytes: reopened.size,
            width: v.videoWidth,
            height: v.videoHeight,
          };
        }, bytes.toString("base64"));
        assert.equal(meta.width, 1920);
        assert.equal(meta.height, 1080);
        assert.ok(Math.abs(meta.duration - 3) <= 1 / 30);
        const deltas = [];
        for (const frame of [0, 45, 89]) {
          const seek = p.getByRole("slider", { name: "Tempo da prévia" });
          await seek.fill(
            String(Math.round(data.start + start * 1000 + (frame * 1000) / 30)),
          );
          await p.evaluate(() => new Promise(requestAnimationFrame));
          // Compare premultiplied colors and alpha only where either image has content.
          const diff = await p.evaluate(
            async ({ frame, map }) => {
              const v = window.testVideo;
              await new Promise((ok, no) => {
                v.onseeked = ok;
                v.onerror = no;
                v.currentTime = (frame + 0.25) / 30;
              });
              const canvas = document.createElement("canvas");
              canvas.width = 1920;
              canvas.height = 1080;
              const c = canvas.getContext("2d", { willReadFrequently: true });
              c.drawImage(v, 0, 0);
              const area = map ? [1500, 0, 420, 1080] : [1500, 700, 420, 380];
              const rgba = c.getImageData(...area).data;
              const ref = document
                .querySelector(".studio canvas")
                .getContext("2d")
                .getImageData(...area).data;
              let total = 0,
                covered = 0;
              for (let i = 0; i < rgba.length; i += 4) {
                if (ref[i + 3] > 8 || rgba[i + 3] > 8) {
                  total += Math.abs(ref[i + 3] - rgba[i + 3]);
                  for (let j = 0; j < 3; j++)
                    total += Math.abs(
                      (ref[i + j] * ref[i + 3]) / 255 -
                        (rgba[i + j] * rgba[i + 3]) / 255,
                    );
                  covered++;
                }
              }
              const blank = c.getImageData(100, 540, 1, 1).data[3];
              const backgrounds = [];
              for (const color of ["#ffffff", "#121212"]) {
                c.fillStyle = color;
                c.fillRect(0, 0, 1920, 1080);
                c.drawImage(v, 0, 0);
                backgrounds.push(c.getImageData(100, 540, 1, 1).data[0]);
              }
              return {
                blank,
                backgrounds,
                covered,
                mae: total / (4 * covered),
              };
            },
            { frame, map },
          );
          assert.equal(diff.blank, 0);
          assert.deepEqual(diff.backgrounds, [255, 18]);
          assert.ok(diff.covered > 500);
          assert.ok(diff.mae < 12, JSON.stringify(diff));
          deltas.push(diff.mae.toFixed(2));
        }
        observed[map ? "combined" : "speed"] = { ...meta, frameErrors: deltas };
      }
      async function readCsv() {
        const [artifact] = await Promise.all([
          p.waitForEvent("download"),
          p.getByRole("button", { name: "Baixar CSV" }).click(),
        ]);
        return readFile(await artifact.path(),"utf8");
      }
      const csv = await readCsv();
      await p.getByLabel("Suavização leve").check();
      assert.equal(await readCsv(), csv);
      assert.match(csv, /latitude,longitude,speedKmh/);
      if (path === files.at(-1)) {
        await p.getByRole("button", { name: "Reproduzir" }).focus();
        await p.keyboard.press("Space");
        await p.getByRole("button", { name: "Pausar" }).press("Space");
        await p.locator(".sidebar").hover();
        await p.getByLabel("Idioma").selectOption("en");
        await p.getByRole("heading", { name: "Overlay studio" }).waitFor();
        await p.getByLabel("Language").selectOption("pt-BR");
      }
      console.log(
        JSON.stringify({
          file,
          channels: data.channels,
          duration: (data.end - data.start) / 1000,
          completed: count,
          partial: data.laps.filter((l) => l.finishTimestamp == null).length,
          start,
          observed,
        }),
      );
    }
    assert.deepEqual(pageErrors, []);
  } finally {
    await b.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
