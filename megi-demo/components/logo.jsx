// ============ MEGI LOGO ANIMATION ============
// Adaptado de la animación original: las letras "megi ia" se colapsan
// hacia las dos i's centrales, que luego forman el wordmark final.

const MegiLogo = ({ size = 120, color = "var(--forest)", accent = "var(--gold)", loop = true, maxLoops = Infinity, restPhase = 0, onDone }) => {
  const [phase, setPhase] = React.useState(0);
  const [loopCount, setLoopCount] = React.useState(0);
  const [resting, setResting] = React.useState(false);
  const totalPhases = 7;

  React.useEffect(() => {
    if (resting) return;
    const delays = { 0: 1200, 1: 400, 2: 400, 3: 400, 4: 400, 5: 2400, 6: 100 };
    const t = setTimeout(() => {
      const next = phase + 1;
      if (next >= totalPhases) {
        const nextLoops = loopCount + 1;
        if (loop && nextLoops < maxLoops) {
          setLoopCount(nextLoops);
          setPhase(0);
        } else {
          // settle at restPhase (0 = full wordmark displayed)
          setPhase(restPhase);
          setResting(true);
          onDone?.();
        }
      } else {
        setPhase(next);
      }
    }, delays[phase] ?? 500);
    return () => clearTimeout(t);
  }, [phase, loop, loopCount, maxLoops, resting, restPhase]);

  const letters = ["m", "e", "g", "i", "\u00A0", "i", "a"];
  const widths = [0.82, 0.54, 0.54, 0.24, 0.30, 0.24, 0.54];
  const SPACING_INCREASE = 0.15;
  const pairsWithMoreSpace = new Set([0, 1, 2, 5]);

  const extraBetween = new Array(widths.length - 1).fill(0);
  for (const p of pairsWithMoreSpace) {
    extraBetween[p] = SPACING_INCREASE * ((widths[p] + widths[p + 1]) / 2);
  }
  const totalW = widths.reduce((a, b) => a + b, 0) + extraBetween.reduce((a, b) => a + b, 0);

  const collapsePhase = { 0: 1, 1: 2, 2: 3, 6: 4 };
  const adjustedFirstI = 10;
  const adjustedSecondI = 70;

  const xFor = (index) => {
    let x = 0;
    for (let i = 0; i < index; i++) {
      x += widths[i];
      if (i < extraBetween.length) x += extraBetween[i];
    }
    return (x - totalW / 2 + widths[index] / 2) * size;
  };

  const styleFor = (letter, index) => {
    const base = {
      display: "inline-block",
      fontFamily: "var(--font-display)",
      fontWeight: 500,
      fontSize: `${size}px`,
      lineHeight: 1,
      position: "absolute",
      left: "50%",
      top: "50%",
      transition: "all 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)",
      color,
    };
    const initialX = xFor(index);
    const isFirstI = index === 3;
    const isSecondI = index === 5;

    if (phase === 0 || phase === 6) {
      return { ...base, opacity: 1, transform: `translate(-50%, -50%) translate(${initialX}px, 0)` };
    }
    if (isFirstI) {
      const tx = phase >= 3 ? adjustedFirstI : initialX;
      return { ...base, opacity: 1, transform: `translate(-50%, -50%) translate(${tx}px, 0)`, color: phase >= 5 ? accent : color, zIndex: 10 };
    }
    if (isSecondI) {
      const tx = phase >= 4 ? adjustedSecondI : initialX;
      return { ...base, opacity: 1, transform: `translate(-50%, -50%) translate(${tx}px, 0)`, color: phase >= 5 ? accent : color, zIndex: 10 };
    }
    if (index === 4) {
      const hide = phase >= 3;
      return { ...base, opacity: hide ? 0 : 1, transform: `translate(-50%, -50%) translate(${initialX}px, 0) scale(${hide ? 0 : 1})` };
    }
    const shouldCollapse = collapsePhase[index] !== undefined && phase >= collapsePhase[index];
    if (shouldCollapse) {
      const tx = index < 4 ? adjustedFirstI : adjustedSecondI;
      return {
        ...base, opacity: 0,
        transform: `translate(-50%, -50%) translate(${tx}px, 0) scale(0.1) rotate(${index < 4 ? -10 : 10}deg)`,
        filter: "blur(6px)",
      };
    }
    return { ...base, opacity: 1, transform: `translate(-50%, -50%) translate(${initialX}px, 0)` };
  };

  return (
    <div style={{ position: "relative", width: size * 5, height: size * 1.2, margin: "0 auto" }}>
      {letters.map((l, i) => (
        <span key={i} style={styleFor(l, i)}>{l}</span>
      ))}
    </div>
  );
};

// Splash overlay shown once on first load
const MegiSplash = ({ onDone }) => {
  const [fading, setFading] = React.useState(false);
  React.useEffect(() => {
    const t1 = setTimeout(() => setFading(true), 4800);
    const t2 = setTimeout(() => onDone?.(), 5400);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      background: "var(--cream)",
      display: "grid", placeItems: "center",
      opacity: fading ? 0 : 1,
      transition: "opacity 0.6s ease-out",
      pointerEvents: fading ? "none" : "auto",
    }}>
      <div style={{ textAlign: "center" }}>
        <MegiLogo size={80} loop={false} onDone={() => {}} />
        <div className="mono" style={{
          fontSize: 10, letterSpacing: "0.32em",
          textTransform: "uppercase", color: "var(--ink-2)",
          marginTop: 120,
        }}>Whisper-MLX · Gemma 4 · CIE-10</div>
      </div>
    </div>
  );
};

// Compact looping logo for the topbar
const MegiLogoMark = ({ size = 28 }) => (
  <div style={{ width: size * 2.4, height: size * 1.3, position: "relative", overflow: "visible" }}>
    <MegiLogo size={size} color="var(--forest)" accent="var(--gold)" loop={true} />
  </div>
);

Object.assign(window, { MegiLogo, MegiSplash, MegiLogoMark });
