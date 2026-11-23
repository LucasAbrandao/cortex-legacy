import { describe, expect, it } from "vitest";
import { analyze, csv, initialLayout, type Session } from "./overlay-render";
const session: Session = {
  start: 0,
  end: 11000,
  laps: [
    { isInvalid: false, number: 1, startTimestamp: 0, finishTimestamp: 3000 },
    {
      isInvalid: false,
      number: 2,
      startTimestamp: 3000,
      finishTimestamp: 10000,
    },
    {
      isInvalid: false,
      number: 3,
      startTimestamp: 10000,
      finishTimestamp: null,
    },
  ],
  samples: [0, 1000, 2000, 3000, 9000, 10000, 11000].map((timestamp) => ({
    timestamp,
    latitude: timestamp / 1e6,
    longitude: 1,
    altitudeM: null,
    headingDeg: null,
    accuracyM: null,
    speedKmh: timestamp === 0 ? 0 : null,
  })),
};
describe("RCZ overlay measurements", () => {
  it("selects a complete reference with continuous GPS coverage", () => {
    expect(analyze(session).tracks.map((l) => l.number)).toEqual([1]);
    expect(analyze(session).available.altitude).toBe(false);
  });
  it("exports original timestamps, zero and missing speed; best starts at the finish", () => {
    const layout = initialLayout(analyze(session).available);
    layout.map.enabled = false;
    layout.best.enabled = true;
    expect(csv(session, layout, 0, 3000).split("\r\n")).toEqual([
      "timestamp,speedKmh,bestMs",
      "0,0,",
      "1000,,",
      "2000,,",
      "3000,,3000",
    ]);
  });
  it("shows an unknown previous lap as missing and retains the earlier valid best", () => {
    const laps = session.laps.map((l) =>
      l.number === 2 ? { ...l, isInvalid: null } : l,
    );
    const layout = initialLayout(analyze(session).available);
    layout.map.enabled = false;
    layout.speed.enabled = false;
    layout.previous.enabled = true;
    layout.best.enabled = true;
    expect(
      csv({ ...session, laps }, layout, 10000, 10000).split("\r\n")[1],
    ).toBe("10000,,3000");
  });
});
