import { useEffect, useRef } from "react";

export function Meter({
  audio,
  active,
}: {
  audio: HTMLAudioElement | null;
  active: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !audio) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    let audioContext: AudioContext;
    let source: MediaElementAudioSourceNode;
    let analyser: AnalyserNode;
    try {
      audioContext = new AudioContext();
      source = audioContext.createMediaElementSource(audio);
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);
      analyser.connect(audioContext.destination);
    } catch {
      return;
    }

    const bins = new Uint8Array(analyser.frequencyBinCount);
    let frame = 0;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const draw = () => {
      if (!reduced) frame = window.requestAnimationFrame(draw);
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
        canvas.width = Math.floor(width * dpr);
        canvas.height = Math.floor(height * dpr);
      }
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);
      if (activeRef.current && audioContext.state === "running") analyser.getByteFrequencyData(bins);
      else bins.fill(18);
      const count = 22;
      const gap = 4;
      const barWidth = Math.max(2, (width - gap * (count - 1)) / count);
      for (let index = 0; index < count; index += 1) {
        const sample = bins[Math.floor((index / count) * bins.length)] ?? 0;
        const level = Math.max(0.06, sample / 255);
        const barHeight = Math.max(3, level * height);
        context.fillStyle = "#e4a54a";
        context.globalAlpha = 0.35 + level * 0.65;
        context.beginPath();
        context.roundRect(index * (barWidth + gap), height - barHeight, barWidth, barHeight, 999);
        context.fill();
      }
      context.globalAlpha = 1;
    };

    const resume = () => {
      if (audioContext.state !== "running") void audioContext.resume();
    };
    document.addEventListener("pointerdown", resume);
    draw();
    return () => {
      document.removeEventListener("pointerdown", resume);
      window.cancelAnimationFrame(frame);
      source.disconnect();
      void audioContext.close();
    };
  }, [audio]);

  return <canvas ref={canvasRef} className="h-12 w-full" aria-hidden="true" />;
}
