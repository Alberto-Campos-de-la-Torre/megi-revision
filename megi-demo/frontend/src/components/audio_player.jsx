import React from "react";
import { apiBlobUrl } from "../api/client";

// Reproductor minimalista. Descarga el audio con token (blob) en el primer play,
// porque <audio src> nativo no manda el header Authorization.
const fmtT = (s) => {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return `${m}:${String(ss).padStart(2, "0")}`;
};

const AudioPlayer = ({ path }) => {
  const ref = React.useRef(null);
  const blobRef = React.useRef(null);
  const [playing, setPlaying] = React.useState(false);
  const [cur, setCur] = React.useState(0);
  const [dur, setDur] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState(null);

  React.useEffect(() => () => { if (blobRef.current) URL.revokeObjectURL(blobRef.current); }, []);

  const toggle = async () => {
    const el = ref.current;
    if (!el) return;
    if (!blobRef.current) {
      setLoading(true); setErr(null);
      try {
        const url = await apiBlobUrl(path);
        blobRef.current = url;
        el.src = url;
        await el.play();
      } catch (e) {
        setErr("No se pudo cargar el audio.");
      } finally {
        setLoading(false);
      }
      return;
    }
    if (el.paused) el.play(); else el.pause();
  };

  const seek = (e) => {
    const el = ref.current;
    if (!el || !dur) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    el.currentTime = ratio * dur;
    setCur(el.currentTime);
  };

  if (err) return <div style={{ fontSize: 12, color: "var(--danger)" }}>{err}</div>;

  return (
    <div className="audio-mini">
      <audio
        ref={ref}
        preload="none"
        onLoadedMetadata={(e) => setDur(e.target.duration || 0)}
        onDurationChange={(e) => setDur(e.target.duration || 0)}
        onTimeUpdate={(e) => setCur(e.target.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
      <button type="button" className="audio-mini-btn" onClick={toggle} disabled={loading} aria-label={playing ? "Pausar" : "Reproducir"}>
        {loading ? "…" : playing ? "❚❚" : "▶"}
      </button>
      <div className="audio-mini-bar" onClick={seek} role="slider" aria-label="Progreso del audio" aria-valuenow={Math.round(cur)}>
        <div className="audio-mini-fill" style={{ width: dur ? `${(cur / dur) * 100}%` : "0%" }} />
      </div>
      <span className="audio-mini-time mono">{fmtT(cur)} / {fmtT(dur)}</span>
    </div>
  );
};

export default AudioPlayer;
