export async function encodeOverlay(
  draw: (c: CanvasRenderingContext2D, t: number) => void,
  start: number,
  end: number,
  signal: AbortSignal,
  progress: (n: number) => void,
) {
  const {
    Output,
    BufferTarget,
    WebMOutputFormat,
    CanvasSource,
    canEncodeVideo,
  } = await import("mediabunny");
  const codec = "vp8";
  if (
    !(await canEncodeVideo(codec, {
      width: 1920,
      height: 1080,
      bitrate: 8_000_000,
    }))
  )
    throw new Error("CODEC");
  const canvas = document.createElement("canvas");
  canvas.width = 1920;
  canvas.height = 1080;
  const ctx = canvas.getContext("2d")!;
  const target = new BufferTarget(),
    output = new Output({ format: new WebMOutputFormat(), target });
  const source = new CanvasSource(canvas, {
    codec,
    bitrate: 8_000_000,
    alpha: "keep",
    latencyMode: "realtime",
    keyFrameInterval: 2,
  });
  output.addVideoTrack(source, { frameRate: 30 });
  await output.start();
  try {
    const count = Math.ceil(((end - start) * 30) / 1000);
    for (let i = 0; i < count; i++) {
      signal.throwIfAborted();
      draw(ctx, start + (i * 1000) / 30);
      await source.add(i / 30, Math.min(1 / 30, (end - start) / 1000 - i / 30));
      if (i % 15 === 0) {
        progress(i / count);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
    signal.throwIfAborted();
    source.close();
    await output.finalize();
    signal.throwIfAborted();
    return new Blob([target.buffer!], { type: "video/webm" });
  } catch (error) {
    if (output.state === "started") await output.cancel();
    throw error;
  }
}
