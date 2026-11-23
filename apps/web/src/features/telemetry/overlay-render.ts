import type { components } from "@cortex/contracts";

type ImportedSession = components["schemas"]["RczSession"];
type Measurement =
  | "latitude"
  | "longitude"
  | "speedKmh"
  | "altitudeM"
  | "headingDeg"
  | "accuracyM";
type Sample = { timestamp: number } & Record<Measurement, number | null>;
export type Session = Pick<ImportedSession, "start" | "end" | "laps"> & {
  samples: Sample[];
};

export function displaySession(data: ImportedSession): Session {
  const samples = data.samples.map(({ timestamp, values }) => {
    function value(key: Measurement) {
      const v = values[key];
      return typeof v === "number" ? v : null;
    }
    return {
      timestamp,
      latitude: value("latitude"),
      longitude: value("longitude"),
      speedKmh: value("speedKmh"),
      altitudeM: value("altitudeM"),
      headingDeg: value("headingDeg"),
      accuracyM: value("accuracyM"),
    };
  });
  return { start: data.start, end: data.end, laps: data.laps, samples };
}

export type Widget =
  | "map"
  | "speed"
  | "lap"
  | "elapsed"
  | "previous"
  | "best"
  | "altitude"
  | "heading"
  | "accuracy";
export const widgets: Widget[] = [
  "map",
  "speed",
  "lap",
  "elapsed",
  "previous",
  "best",
  "altitude",
  "heading",
  "accuracy",
];
export type Layout = Record<
  Widget,
  { enabled: boolean; corner: string; scale: number }
>;
export type Style = {
  smooth: boolean;
  outline: boolean;
  marker: string;
  digital: boolean;
  color: string;
};
export const defaults: Style = {
  smooth: false,
  outline: false,
  marker: "arrow",
  digital: false,
  color: "#ff344d",
};
export const labels = {
  map: ["Mapa", "Map"],
  speed: ["Velocidade", "Speed"],
  lap: ["Volta", "Lap"],
  elapsed: ["Tempo da volta", "Lap time"],
  previous: ["Anterior", "Previous"],
  best: ["Melhor", "Best"],
  altitude: ["Altitude", "Altitude"],
  heading: ["Rumo GPS", "GPS heading"],
  accuracy: ["Precisão GPS", "GPS accuracy"],
};
export function timeText(ms: number) {
  return (
    Math.floor(ms / 60000) +
    ":" +
    ((ms % 60000) / 1000).toFixed(3).padStart(6, "0")
  );
}
export function analyze(s: Session) {
  const pos = (p: Sample) => p.latitude !== null && p.longitude !== null;
  const intervals = s.samples
    .slice(1)
    .map((p, i) => p.timestamp - s.samples[i].timestamp)
    .sort((a, b) => a - b);
  const gap = Math.min(2000, intervals[Math.floor(intervals.length / 2)] * 1.8);
  const tracks = s.laps
    .filter((l) => {
      if (l.isInvalid !== false || l.finishTimestamp == null) return false;
      const points = s.samples.filter(
        (p) =>
          p.timestamp >= l.startTimestamp && p.timestamp <= l.finishTimestamp!,
      );
      return (
        points.length >= 3 &&
        points.every(
          (p, i) =>
            pos(p) && (!i || p.timestamp - points[i - 1].timestamp <= gap),
        ) &&
        points[0].timestamp - l.startTimestamp <= gap &&
        l.finishTimestamp - points.at(-1)!.timestamp <= gap
      );
    })
    .sort(
      (a, b) =>
        a.finishTimestamp! -
        a.startTimestamp -
        (b.finishTimestamp! - b.startTimestamp),
    );
  const timed = s.laps.some(
    (l) => l.isInvalid === false && l.finishTimestamp != null,
  );
  const available: Record<Widget, boolean> = {
    map: s.samples.some(pos),
    heading: s.samples.some((p) => p.headingDeg !== null),
    accuracy: s.samples.some((p) => p.accuracyM !== null),
    speed: s.samples.some((p) => p.speedKmh !== null),
    altitude: s.samples.some((p) => p.altitudeM !== null),
    lap: !!s.laps.length,
    elapsed: !!s.laps.length,
    previous: timed,
    best: timed,
  };
  return { tracks, gap, available };
}
export function initialLayout(available: Record<Widget, boolean>): Layout {
  return Object.fromEntries(
    widgets.map((k) => [
      k,
      {
        enabled: available[k] && (k === "map" || k === "speed"),
        corner: k === "map" ? "tr" : k === "speed" ? "br" : "tl",
        scale: 1,
      },
    ]),
  ) as Layout;
}
function sampleIndex(rows: Sample[], t: number) {
  let lo = 0,
    hi = rows.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (rows[mid].timestamp <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}
const timingWidgets = ["lap", "elapsed", "previous", "best"] as const;
type TimingWidget = (typeof timingWidgets)[number];

function lapReadings(
  laps: Session["laps"],
  clock: number,
): Record<TimingWidget, number | null> {
  let lap = null,
    elapsed = null,
    previous = null,
    best: number | null = null;
  for (const record of laps) {
    if (record.startTimestamp > clock) break;
    if (record.finishTimestamp == null || clock < record.finishTimestamp) {
      lap = record.number;
      elapsed = clock - record.startTimestamp;
      break;
    }
    previous =
      record.isInvalid === false
        ? record.finishTimestamp - record.startTimestamp
        : null;
    if (previous !== null)
      best = best === null ? previous : Math.min(previous, best);
  }
  return { lap, elapsed, previous, best };
}
function readingText(
  widget: Widget,
  sample: Sample | undefined,
  timing: Record<TimingWidget, number | null>,
) {
  switch (widget) {
    case "heading":
      return sample?.headingDeg == null
        ? "—"
        : Math.round(sample.headingDeg) + "°";
    case "accuracy":
      return sample?.accuracyM == null
        ? "—"
        : sample.accuracyM.toFixed(1) + " m";
    case "altitude":
      return sample?.altitudeM == null
        ? "—"
        : Math.round(sample.altitudeM) + " m";
    case "lap":
      return String(timing.lap ?? "—");
    case "elapsed":
    case "previous":
    case "best":
      return timing[widget] == null ? "—" : timeText(timing[widget]);
    default:
      return "—";
  }
}

export function renderer(
  s: Session,
  gap: number,
  reference: number | null,
  layout: Layout,
  style: Style,
  lang: number,
) {
  const lap = s.laps.find((l) => l.number === reference);
  const points = s.samples.filter(
    (p) =>
      !lap ||
      (p.timestamp >= lap.startTimestamp &&
        p.timestamp <= lap.finishTimestamp!),
  );
  const valid = points.filter(
    (p) => p.latitude !== null && p.longitude !== null,
  );
  const origin = valid[0];
  const aspect = Math.cos(((origin?.latitude ?? 0) * Math.PI) / 180);
  const project = (p: Sample) => ({
    x: (p.longitude! - origin.longitude!) * aspect,
    y: origin.latitude! - p.latitude!,
  });
  const coords = valid.map(project);
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const p of coords) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const zoom = 245 / Math.max(1e-9, maxX - minX, maxY - minY);
  const point = (p: Sample) => {
    const q = project(p);
    return {
      x: (q.x - (minX + maxX) / 2) * zoom,
      y: (q.y - (minY + maxY) / 2) * zoom,
    };
  };
  const track = new Path2D();
  points.forEach((p, i) => {
    if (p.latitude === null || p.longitude === null) return;
    let { x, y } = point(p);
    const a = points[i - 1],
      b = points[i + 1];
    const joins =
      a &&
      a.latitude !== null &&
      a.longitude !== null &&
      p.timestamp - a.timestamp <= gap;
    if (
      style.smooth &&
      joins &&
      b &&
      b.latitude !== null &&
      b.longitude !== null &&
      b.timestamp - p.timestamp <= gap
    ) {
      const prev = point(a),
        next = point(b),
        dx = (prev.x + next.x - 2 * x) / 4,
        dy = (prev.y + next.y - 2 * y) / 4;
      const divisor = Math.max(1, Math.hypot(dx, dy) * layout.map.scale);
      x += dx / divisor;
      y += dy / divisor;
    }
    if (joins) track.lineTo(x, y);
    else track.moveTo(x, y);
  });
  const topSpeed = Math.max(
    80,
    Math.ceil(
      s.samples.reduce((v, p) => Math.max(v, p.speedKmh ?? 0), 0) / 20,
    ) * 20,
  );
  // Keep top and bottom stacks on the same side inside the 1080p frame.
  const occupied = { l: 0, r: 0 };
  for (const k of widgets) {
    const item = layout[k];
    if (item.enabled)
      occupied[item.corner.endsWith("r") ? "r" : "l"] +=
        (k === "map" || k === "speed" ? 280 : 62) * item.scale + 6;
  }
  return (ctx: CanvasRenderingContext2D, t: number) => {
    ctx.clearRect(0, 0, 1920, 1080);
    const index = sampleIndex(s.samples, t),
      raw = s.samples[index],
      next = s.samples[index + 1];
    const sample =
      raw &&
      (t === raw.timestamp || (next && next.timestamp - raw.timestamp <= gap))
        ? raw
        : undefined;
    const timing = lapReadings(s.laps, t);
    const offsets: Record<string, number> = {};
    widgets.forEach((k) => {
      const item = layout[k];
      if (!item.enabled) return;
      const scale =
        item.scale *
        Math.min(1, 970 / occupied[item.corner.endsWith("r") ? "r" : "l"]);
      const big = k === "map" || k === "speed",
        height = (big ? 280 : 62) * scale,
        width = (big ? 280 : 370) * scale;
      const down = item.corner.startsWith("t"),
        offset = offsets[item.corner] ?? 0;
      ctx.save();
      ctx.translate(
        item.corner.endsWith("r") ? 1920 - 32 - width / 2 : 32 + width / 2,
        down ? 32 + offset + height / 2 : 1080 - 32 - offset - height / 2,
      );
      offsets[item.corner] = offset + height + 6;
      ctx.scale(scale, scale);
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.fillStyle = "#fff";
      ctx.strokeStyle = "#fff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = "bold 36px Arial";
      if (k === "map" && origin) {
        if (style.outline) {
          ctx.lineWidth = 8;
          ctx.strokeStyle = "#101018";
          ctx.stroke(track);
        }
        ctx.lineWidth = 4;
        ctx.strokeStyle = "#fff";
        ctx.stroke(track);
        if (sample && sample.latitude !== null && sample.longitude !== null) {
          const q = point(sample);
          ctx.translate(q.x, q.y);
          ctx.fillStyle = style.color;
          if (style.marker === "dot") {
            ctx.beginPath();
            ctx.arc(0, 0, 8, 0, 2 * Math.PI);
            ctx.fill();
          } else {
            const prev = s.samples[index - 1];
            if (
              prev &&
              prev.latitude !== null &&
              prev.longitude !== null &&
              sample.timestamp - prev.timestamp <= gap
            ) {
              const a = point(prev);
              ctx.rotate(Math.atan2(q.y - a.y, q.x - a.x) + Math.PI / 2);
            }
            if (style.marker === "kart") {
              ctx.fillRect(-6, -12, 12, 24);
              for (const x of [-11, 6])
                for (const y of [-9, 5]) ctx.fillRect(x, y, 5, 7);
            } else {
              ctx.beginPath();
              ctx.moveTo(0, -13);
              ctx.lineTo(9, 10);
              ctx.lineTo(0, 6);
              ctx.lineTo(-9, 10);
              ctx.closePath();
              ctx.fill();
            }
          }
        }
      } else if (k === "speed") {
        const speed = sample?.speedKmh;
        if (!style.digital) {
          ctx.beginPath();
          ctx.fillStyle = "rgba(12,15,22,.75)";
          ctx.arc(0, 0, 115, 0, Math.PI * 2);
          ctx.fill();
          for (let i = 0; i <= 40; i++) {
            const angle = Math.PI * (0.75 + (1.5 * i) / 40);
            ctx.save();
            ctx.rotate(angle);
            ctx.beginPath();
            ctx.moveTo(i % 5 ? 98 : 89, 0);
            ctx.lineTo(105, 0);
            ctx.lineWidth = i % 5 ? 2 : 4;
            ctx.stroke();
            ctx.restore();
            if (i % 5 === 0) {
              ctx.fillStyle = "#fff";
              ctx.font = "16px Arial";
              ctx.fillText(
                String(Math.round((topSpeed * i) / 40)),
                76 * Math.cos(angle),
                76 * Math.sin(angle),
              );
            }
          }
          if (speed != null) {
            ctx.save();
            ctx.rotate(Math.PI * (0.75 + (1.5 * speed) / topSpeed));
            ctx.strokeStyle = style.color;
            ctx.lineWidth = 6;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(86, 0);
            ctx.stroke();
            ctx.restore();
          }
        }
        ctx.fillStyle = "#fff";
        ctx.shadowColor = "#000";
        ctx.shadowBlur = 4;
        ctx.fillText(
          speed == null ? "—" : String(Math.round(speed)),
          0,
          style.digital ? 0 : 54,
        );
        ctx.font = "22px Arial";
        ctx.fillText("km/h", 0, style.digital ? 33 : 85);
      } else {
        const value = readingText(k, sample, timing);
        ctx.fillStyle = "rgba(12,15,22,.8)";
        ctx.fillRect(-180, -29, 360, 58);
        ctx.fillStyle = "#fff";
        ctx.font = "bold 28px Arial";
        ctx.fillText(labels[k][lang] + "  " + value, 0, 0);
      }
      ctx.restore();
    });
  };
}
export function csv(s: Session, layout: Layout, start: number, end: number) {
  const columns: (keyof Sample)[] = ["timestamp"];
  if (layout.map.enabled) columns.push("latitude", "longitude");
  if (layout.speed.enabled) columns.push("speedKmh");
  if (layout.altitude.enabled) columns.push("altitudeM");
  if (layout.heading.enabled) columns.push("headingDeg");
  if (layout.accuracy.enabled) columns.push("accuracyM");
  const timing = timingWidgets.filter((k) => layout[k].enabled);
  const rows = s.samples
    .filter((p) => p.timestamp >= start && p.timestamp <= end)
    .map((p) => {
      const readings = lapReadings(s.laps, p.timestamp);
      return [
        ...columns.map((k) => p[k]),
        ...timing.map((k) => readings[k]),
      ].join(",");
    });
  return [
    [
      ...columns,
      ...timing.map((k) => (k === "lap" ? "lapNumber" : k + "Ms")),
    ].join(","),
    ...rows,
  ].join("\r\n");
}
