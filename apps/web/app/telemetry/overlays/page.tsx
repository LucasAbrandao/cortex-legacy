"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCortex } from "../../../src/features/navigation/app-shell";
import { PageHeader } from "../../../src/shared/ui";
import {
  analyze,
  csv,
  defaults,
  displaySession,
  initialLayout,
  labels,
  renderer,
  timeText,
  widgets,
  type Layout,
  type Session,
  type Style,
} from "../../../src/features/telemetry/overlay-render";
import { encodeOverlay } from "../../../src/features/telemetry/overlay-export";
import "./studio.css";

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function Studio() {
  const { locale } = useCortex(),
    pt = locale === "pt-BR";
  const [session, setSession] = useState<Session | null>(null),
    [status, setStatus] = useState("");
  const [fileName, setFileName] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  async function upload(file?: File) {
    request.current?.abort();
    setSession(null);
    setFileName("");
    setStatus("");
    if (!file) return;
    if (file.size > 32 * 1024 ** 2) {
      setStatus("size");
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    setStatus("loading");
    try {
      const res = await fetch(
        (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000/api") +
          "/telemetry/rcz",
        {
          method: "POST",
          body: file,
          headers: { "Content-Type": "application/octet-stream" },
          cache: "no-store",
          signal: controller.signal,
        },
      );
      if (!res.ok) {
        if (!controller.signal.aborted)
          setStatus(
            res.status === 413
              ? "size"
              : res.status >= 500
                ? "network"
                : "format",
          );
        return;
      }
      const data = await res.json();
      controller.signal.throwIfAborted();
      setSession(displaySession(data));
      setFileName(file.name);
      setStatus("");
    } catch (e) {
      if (!controller.signal.aborted)
        setStatus(e instanceof TypeError ? "network" : "format");
    }
  }
  const messages: Record<string, string[]> = {
    loading: ["Lendo sessão…", "Reading session…"],
    size: ["Limite de 32 MiB excedido.", "32 MiB limit exceeded."],
    format: [
      "Estrutura RCZ inválida ou incompatível.",
      "Invalid or unsupported RCZ layout.",
    ],
    network: [
      "API indisponível. Tente novamente.",
      "API unavailable. Try again.",
    ],
  };
  return (
    <div className="page-stack telemetry-page studio">
      <PageHeader
        eyebrow="Telemetry Lab"
        title={pt ? "Estúdio de overlays" : "Overlay studio"}
      />
      <section className="telemetry-panel">
        <label className="button button-secondary studio-file">
          {pt ? "Selecionar arquivo RCZ" : "Select RCZ file"}{" "}
          <input
            className="sr-only"
            type="file"
            accept=".rcz"
            onChange={(e) => {
              void upload(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
        <p>
          {pt
            ? "O RCZ é enviado à API, processado em memória e descartado após a leitura."
            : "The RCZ is sent to the API, processed in memory and discarded after reading."}
        </p>
        <span role="status">
          {session ? fileName : messages[status]?.[pt ? 0 : 1]}
        </span>
        {status === "loading" && (
          <button
            onClick={() => {
              request.current?.abort();
              setStatus("");
            }}
          >
            {pt ? "Cancelar" : "Cancel"}
          </button>
        )}
      </section>
      {session && <Editor session={session} pt={pt} />}
    </div>
  );
}
function Editor({ session, pt }: { session: Session; pt: boolean }) {
  const lang = pt ? 0 : 1,
    tr = (a: string, b: string) => (pt ? a : b);
  const { tracks, gap, available } = useMemo(() => analyze(session), [session]);
  const [layout, setLayout] = useState<Layout>(() => initialLayout(available)),
    [style, setStyle] = useState<Style>(defaults);
  const [reference, setReference] = useState<number | null>(
    tracks[0]?.number ?? null,
  );
  const first = session.start,
    last = session.end;
  const [start, setStart] = useState(first),
    [end, setEnd] = useState(last),
    [time, setTime] = useState(first),
    [range, setRange] = useState("all");
  const [playing, setPlaying] = useState(false),
    [progress, setProgress] = useState<number | null>(null),
    [message, setMessage] = useState("");
  const canvas = useRef<HTMLCanvasElement>(null),
    job = useRef<AbortController | null>(null);
  const draw = useMemo(
    () => renderer(session, gap, reference, layout, style, lang),
    [session, gap, reference, layout, style, lang],
  );
  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (ctx) draw(ctx, time);
  }, [draw, time]);
  useEffect(() => () => job.current?.abort(), []);
  const clock = useRef(first);
  const seek = useCallback((t: number) => {
    clock.current = t;
    setTime(t);
  }, []);
  useEffect(() => {
    if (!playing) return;
    const base = clock.current,
      then = performance.now();
    let id = 0;
    const step = () => {
      const t = Math.min(end, base + performance.now() - then);
      seek(t);
      if (t < end) id = requestAnimationFrame(step);
      else setPlaying(false);
    };
    id = requestAnimationFrame(step);
    return () => cancelAnimationFrame(id);
  }, [playing, end, seek]);
  function bounds(a: number, b: number) {
    setPlaying(false);
    setStart(a);
    setEnd(b);
    seek(a);
  }
  const valid =
    end > start &&
    start >= first &&
    end <= last &&
    widgets.some((k) => layout[k].enabled);
  async function video() {
    if (!valid || job.current) return;
    const controller = new AbortController();
    job.current = controller;
    setPlaying(false);
    setMessage("");
    setProgress(0);
    try {
      const blob = await encodeOverlay(
        draw,
        start,
        end,
        controller.signal,
        setProgress,
      );
      save(blob, "cortex-overlay.webm");
      setMessage(tr("WebM pronto.", "WebM ready."));
    } catch {
      if (!controller.signal.aborted)
        setMessage(
          tr(
            "Falha ao codificar WebM. Verifique o suporte a VP8 no navegador.",
            "WebM encoding failed. Check browser VP8 support.",
          ),
        );
      else setMessage(tr("Exportação cancelada.", "Export cancelled."));
    } finally {
      job.current = null;
      setProgress(null);
    }
  }
  const chooseRange = (value: string) => {
    setRange(value);
    const lap = session.laps.find((l) => String(l.number) === value);
    if (lap)
      bounds(
        Math.max(first, lap.startTimestamp),
        Math.min(last, lap.finishTimestamp ?? last),
      );
    else if (value === "all") bounds(first, last);
  };
  return (
    <section className="telemetry-panel">
      <p>
        {timeText(last - first)} ·{" "}
        {session.laps.filter((l) => l.finishTimestamp != null).length}{" "}
        {tr("voltas completas", "completed laps")} ·{" "}
        {session.laps.filter((l) => l.finishTimestamp == null).length}{" "}
        {session.laps.filter((l) => l.finishTimestamp == null).length === 1
          ? tr("volta parcial", "partial lap")
          : tr("voltas parciais", "partial laps")}
      </p>
      <canvas
        aria-label={tr("Prévia transparente", "Transparent preview")}
        width="1920"
        height="1080"
        ref={canvas}
      />
      <div className="studio-row">
        <button
          disabled={end <= start}
          onClick={() => {
            if (time >= end) seek(start);
            setPlaying(!playing);
          }}
        >
          {playing ? tr("Pausar", "Pause") : tr("Reproduzir", "Play")}
        </button>
        <input
          aria-label={tr("Tempo da prévia", "Preview time")}
          type="range"
          min={start}
          max={Math.max(start, end)}
          step="1"
          value={time}
          onChange={(e) => {
            setPlaying(false);
            seek(+e.target.value);
          }}
        />
        <output>{timeText(time - first)}</output>
      </div>
      <fieldset disabled={progress !== null}>
        <legend>{tr("Período", "Period")}</legend>
        <label>
          {tr("Exportar", "Export")}{" "}
          <select value={range} onChange={(e) => chooseRange(e.target.value)}>
            <option value="all">{tr("Sessão inteira", "Full session")}</option>
            <option value="custom">{tr("Intervalo", "Interval")}</option>
            {session.laps.map((l) => (
              <option key={l.number} value={l.number}>
                {tr("Volta", "Lap")} {l.number}
                {l.finishTimestamp == null
                  ? tr(" (parcial)", " (partial)")
                  : ""}
              </option>
            ))}
          </select>
        </label>
        {range === "custom" && (
          <>
            {[true, false].map((isStart) => (
              <label key={String(isStart)}>
                {isStart
                  ? tr("Início (s)", "Start (s)")
                  : tr("Fim (s)", "End (s)")}{" "}
                <input
                  type="number"
                  min="0"
                  max={(last - first) / 1000}
                  step=".001"
                  value={((isStart ? start : end) - first) / 1000}
                  onChange={(e) => {
                    const t = first + Math.round(+e.target.value * 1000);
                    bounds(isStart ? t : start, isStart ? end : t);
                  }}
                />
              </label>
            ))}
          </>
        )}
      </fieldset>
      {(end <= start || start < first || end > last) && (
        <p role="status">
          {tr(
            "Escolha um intervalo dentro da sessão, com o fim após o início.",
            "Choose a range within the session, ending after its start.",
          )}
        </p>
      )}
      <fieldset disabled={progress !== null}>
        <legend>{tr("Indicadores", "Indicators")}</legend>
        {widgets
          .filter((k) => available[k])
          .map((k) => (
            <div className="studio-row" key={k}>
              <label>
                <input
                  type="checkbox"
                  checked={layout[k].enabled}
                  onChange={(e) =>
                    setLayout({
                      ...layout,
                      [k]: { ...layout[k], enabled: e.target.checked },
                    })
                  }
                />{" "}
                {labels[k][lang]}
              </label>
              {layout[k].enabled && (
                <>
                  <select
                    aria-label={
                      labels[k][lang] + " · " + tr("Posição", "Position")
                    }
                    value={layout[k].corner}
                    onChange={(e) =>
                      setLayout({
                        ...layout,
                        [k]: { ...layout[k], corner: e.target.value },
                      })
                    }
                  >
                    {["tl", "tr", "bl", "br"].map((v, i) => (
                      <option key={v} value={v}>
                        {
                          (pt
                            ? [
                                "Superior esquerdo",
                                "Superior direito",
                                "Inferior esquerdo",
                                "Inferior direito",
                              ]
                            : [
                                "Top left",
                                "Top right",
                                "Bottom left",
                                "Bottom right",
                              ])[i]
                        }
                      </option>
                    ))}
                  </select>
                  <label>
                    {tr("Escala", "Scale")}{" "}
                    <input
                      type="range"
                      min=".5"
                      max="1.5"
                      step=".1"
                      value={layout[k].scale}
                      onChange={(e) =>
                        setLayout({
                          ...layout,
                          [k]: { ...layout[k], scale: +e.target.value },
                        })
                      }
                    />
                  </label>
                </>
              )}
            </div>
          ))}
      </fieldset>
      <fieldset disabled={progress !== null}>
        <legend>{tr("Estilo", "Style")}</legend>
        {layout.map.enabled && (
          <>
            <label>
              {tr("Traçado de referência", "Reference trace")}{" "}
              <select
                value={reference ?? ""}
                onChange={(e) =>
                  setReference(e.target.value ? +e.target.value : null)
                }
              >
                <option value="">
                  {tr("Traçado da sessão", "Session trace")}
                </option>
                {tracks.map((l) => (
                  <option key={l.number} value={l.number}>
                    {tr("Volta", "Lap")} {l.number}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={style.smooth}
                onChange={(e) =>
                  setStyle({ ...style, smooth: e.target.checked })
                }
              />{" "}
              {tr("Suavização leve", "Light smoothing")}
            </label>
            <label>
              <input
                type="checkbox"
                checked={style.outline}
                onChange={(e) =>
                  setStyle({ ...style, outline: e.target.checked })
                }
              />{" "}
              {tr("Contorno", "Outline")}
            </label>
            <label>
              {tr("Marcador", "Marker")}{" "}
              <select
                value={style.marker}
                onChange={(e) => setStyle({ ...style, marker: e.target.value })}
              >
                <option value="arrow">{tr("Seta", "Arrow")}</option>
                <option value="dot">{tr("Ponto", "Dot")}</option>
                <option value="kart">Kart</option>
              </select>
            </label>
            <label>
              {tr("Cor", "Color")}{" "}
              <input
                type="color"
                value={style.color}
                onChange={(e) => setStyle({ ...style, color: e.target.value })}
              />
            </label>
          </>
        )}
        {layout.speed.enabled && (
          <label>
            <input
              type="checkbox"
              checked={style.digital}
              onChange={(e) =>
                setStyle({ ...style, digital: e.target.checked })
              }
            />{" "}
            {tr("Velocímetro digital", "Digital speedometer")}
          </label>
        )}
      </fieldset>
      <div className="studio-row">
        <button
          disabled={!valid || progress !== null}
          onClick={() => void video()}
        >
          {tr("Baixar WebM", "Download WebM")}
        </button>
        <button
          disabled={!valid || progress !== null}
          onClick={() =>
            save(
              new Blob([csv(session, layout, start, end)], {
                type: "text/csv",
              }),
              "cortex.csv",
            )
          }
        >
          {tr("Baixar CSV", "Download CSV")}
        </button>
        {progress !== null && (
          <>
            <progress
              value={progress}
              max="1"
              aria-label={tr("Exportação", "Export")}
            />
            <button onClick={() => job.current?.abort()}>
              {tr("Cancelar", "Cancel")}
            </button>
          </>
        )}
      </div>
      <p role="status">{message}</p>
    </section>
  );
}
