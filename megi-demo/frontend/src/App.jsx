import React, { useState, useEffect } from "react";
import { Topbar } from "./components/shared";
import { MegiSplash } from "./components/logo";
import Dashboard from "./components/dashboard";
import Consulta from "./components/consulta";
import EstudiosPaciente from "./components/estudios_paciente";
import Revision from "./components/revision";
import Imprimir from "./components/imprimir";
import Pacientes from "./components/pacientes";
import Estadisticas from "./components/estadisticas";
import Guias from "./components/guias";
import Anestesio from "./components/anestesio";
import RadiologiaMegi from "./components/radiologia_megi";
import MegiVoz from "./components/megi_voz";
import VoiceBar from "./components/voice_bar";
import ConsultorFarmacos from "./components/consultor_farmacos";
import Administracion from "./components/administracion";
import Audit from "./components/audit";
import ErrorBoundary from "./components/error_boundary";
import Tweaks from "./components/tweaks";
import Login from "./components/login";
import Setup from "./components/setup";
import ChangePassword from "./components/change_password";
import MiPerfil from "./components/mi_perfil";
import VersionSelect from "./components/version_select";
import { MegiDataProvider, usePatients, useDoctor } from "./api/MegiDataProvider";
import { api } from "./api/client";
import { TranscriptionWarning, VersionWarning, useServiceHealth } from "./components/service_health";
import { defaultAppVersion, getAppVersion, isValidAppVersion } from "./lib/app_versions";
import { useBrowserHistory } from "./lib/nav_history";
import { useScrollMemoria } from "./lib/scroll_memoria";

// ============ MAIN APP ============

const ACCENT_COLORS = {
  teal: "#3a7d7b",
  blue: "#3a5e8b",
  forest: "#2d3b2d",
  gold: "#8b7355",
  rust: "#8b4a3a",
};

const TEXT_SCALES = { sm: 0.9, md: 1.0, lg: 1.12, xl: 1.25 };
const DENSITY = { compact: 0.85, cozy: 1.0 };

// Standalone app: there is no parent builder host. Guard all postMessage usage
// so it is a no-op locally but still works if MEGI is ever embedded again.
const isEmbedded = typeof window !== "undefined" && window.parent !== window;

const AppInner = ({ user, appVersion, onLogout }) => {
  const PATIENTS = usePatients();
  const DOCTOR = useDoctor();
  const voiceEnabled = !!appVersion?.features?.voiceAgent;
  const health = useServiceHealth();   // §4: salud real de ASR/LLM/RAG

  const [changePw, setChangePw] = useState(false);  // cambio de contraseña voluntario
  const [miPerfil, setMiPerfil] = useState(false);  // perfil profesional (cédula)
  const [voiceFocus, setVoiceFocus] = useState(null); // paciente a enfocar por voz (Fase 2)
  const [splash, setSplash] = useState(() => !sessionStorage.getItem("megi.splash.done"));
  // persistent view
  const [view, setView] = useState(() => {
    const saved = localStorage.getItem("megi.view") || appVersion?.startView || "dashboard";
    if (saved === "calculadoras") return "dashboard";     // sección retirada (11-oct): ahora es Anestesio
    return !voiceEnabled && saved === "voz" ? "dashboard" : saved;
  });
  const [patient, setPatient] = useState(() => {
    const id = localStorage.getItem("megi.patient");
    return PATIENTS.find((p) => p.id === id) || null;
  });
  useEffect(() => { localStorage.setItem("megi.view", view); }, [view]);
  useEffect(() => { if (patient) localStorage.setItem("megi.patient", patient.id); }, [patient]);

  // Vista previa para "MEGI, volver" (router de comandos, Fase 2).
  const viewRef = React.useRef(view);
  const prevViewRef = React.useRef("dashboard");
  useEffect(() => { prevViewRef.current = viewRef.current; viewRef.current = view; }, [view]);

  // La flecha de regreso del navegador vuelve a la pantalla anterior de MEGI en
  // vez de abandonar la app. Viaja el estado completo (vista + paciente +
  // overlay) porque volver a "Consulta" sin paciente deja una pantalla rota.
  // Abrir una pantalla empieza arriba; VOLVER (atrás del navegador o «←») la
  // deja donde estaba. `regresoRef` marca que el próximo cambio es un regreso.
  const regresoRef = React.useRef(false);
  const volverA = (v) => { regresoRef.current = true; setView(v); };
  useScrollMemoria(view, regresoRef);

  useBrowserHistory(
    { view, patientId: patient?.id || null, overlay: miPerfil ? "perfil" : changePw ? "password" : null },
    (st) => {
      regresoRef.current = true;
      setMiPerfil(st.overlay === "perfil");
      setChangePw(st.overlay === "password");
      setView(st.view || "dashboard");
      setPatient(st.patientId ? (PATIENTS.find((p) => p.id === st.patientId) || null) : null);
    },
  );

  const TWEAK_DEFAULTS = {
    "theme": "light",
    "accent": "teal",
    "density": "cozy",
    "textSize": "md",
    "showTranscript": true,
    "inst": "priv"
  };

  const [config, setConfig] = useState(() => {
    const saved = localStorage.getItem("megi.config");
    return saved ? { ...TWEAK_DEFAULTS, ...JSON.parse(saved) } : TWEAK_DEFAULTS;
  });
  const [showTweaks, setShowTweaks] = useState(false);

  useEffect(() => {
    localStorage.setItem("megi.config", JSON.stringify(config));

    const root = document.documentElement;
    root.setAttribute("data-theme", config.theme);
    root.style.setProperty("--accent", ACCENT_COLORS[config.accent] || ACCENT_COLORS.teal);
    root.style.setProperty("--text-scale", TEXT_SCALES[config.textSize] || 1);
    root.style.setProperty("--density", DENSITY[config.density] || 1);

    // persist to host only when embedded in a builder; no-op standalone
    if (isEmbedded) {
      window.parent.postMessage({ type: "__edit_mode_set_keys", edits: config }, "*");
    }
  }, [config]);

  // edit-mode protocol (only relevant when embedded in a builder host)
  useEffect(() => {
    if (!isEmbedded) return;
    const handler = (e) => {
      if (e.data?.type === "__activate_edit_mode") setShowTweaks(true);
      if (e.data?.type === "__deactivate_edit_mode") setShowTweaks(false);
    };
    window.addEventListener("message", handler);
    window.parent.postMessage({ type: "__edit_mode_available" }, "*");
    return () => window.removeEventListener("message", handler);
  }, []);

  // local opener for Tweaks (no builder host in standalone): Ctrl/Cmd + ,
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        setShowTweaks((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Consulta activa: el id de consulta lo posee App para que consulta -> revisión
  // -> impresión compartan la MISMA nota real (el SOAP final se persiste por id).
  const [consultationId, setConsultationId] = useState(null);
  // Motivo de HOY. Vive aquí y no en la consulta porque la consulta se crea de
  // forma diferida (al empezar a grabar) y «Antes de empezar» lo necesita antes.
  const [motivoHoy, setMotivoHoy] = useState("");
  const [reviewData, setReviewData] = useState(null);
  const consultRef = React.useRef({ id: null, promise: null, patientId: null });

  // Tras un REFRESCO en plena consulta: la vista y el paciente vuelven de
  // localStorage, pero la consulta no — quedaba consultationId=null, el motivo
  // vacío (la cabecera enseñaba el del alta) y consultRef sin paciente (grabar
  // habría creado una consulta sin patient_id). La fuente de verdad es el
  // backend, que ya tiene el borrador de hoy con su motivo: nos volvemos a
  // enganchar a él. `solo_retomar` garantiza que un refresco nunca CREA nada;
  // si no hay borrador abierto (la consulta ya se cerró), se vuelve a la agenda.
  useEffect(() => {
    if ((view !== "consulta" && view !== "estudios") || !patient || consultationId) return;
    const st = consultRef.current;
    // Si beginConsultation ya dejó una creación en vuelo (arranque normal), no
    // es un refresco: no competir con ella. El 404 de `solo_retomar` llegando
    // antes que esa creación devolvería al médico a la agenda sin motivo.
    if (st.promise || st.id) return;
    st.patientId = patient.id;
    let vivo = true;
    api.createConsultation({ patient_id: patient.id, solo_retomar: true })
      .then((c) => {
        if (!vivo) return;
        st.id = c.id; st.motivo = c.motivo || "";
        setConsultationId(c.id);
        setMotivoHoy(c.motivo || "");
      })
      .catch(() => { if (vivo) setView("dashboard"); });
    return () => { vivo = false; };
    // Solo al montar/entrar: reaccionar a consultationId aquí lo volvería a lanzar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, patient]);

  const beginConsultation = (p, motivo) => {
    const pat = p || patient;
    if (pat) setPatient(pat);
    setReviewData(null);
    setConsultationId(null);
    // El motivo de HOY viaja hasta createConsultation. Si no se indica, el
    // backend lo busca en la cita pendiente (agendar ya lo exige); solo queda
    // vacío en un paciente que llega sin cita y sin que nadie lo escriba.
    consultRef.current = { id: null, promise: null, patientId: pat ? pat.id : null,
                           motivo: motivo || "" };
    setMotivoHoy(motivo || "");
    // Si el médico dijo a qué viene, eso YA es empezar una consulta: se crea en
    // el backend ahora, no al pulsar grabar. Si no, un cierre de pestaña o una
    // interrupción le obligan a volver a escribirlo. La creación diferida
    // seguía teniendo sentido para «abrir el expediente y mirar», que es lo que
    // evitaba llenar la base de borradores vacíos — no para esto.
    if (motivo) {
      const st = consultRef.current;
      st.promise = api.createConsultation({ patient_id: st.patientId, motivo })
        .then((c) => {
          st.id = c.id; setConsultationId(c.id);
          if (c.motivo) setMotivoHoy(c.motivo);   // el backend puede retomar una abierta
          return c.id;
        })
        .catch((e) => { st.promise = null; throw e; });
    }
    // Antes del SOAP: qué estudios trae el paciente (fotos, PDF, DICOM; desde el
    // escritorio o desde el teléfono por QR). La pantalla crea la consulta al
    // entrar si el motivo no lo hizo ya.
    setView("estudios");
  };

  // Creación diferida: la consulta se crea en el backend SOLO cuando empieza la
  // grabación (no al abrir el paciente), para no dejar borradores vacíos.
  const ensureConsultation = React.useCallback(async () => {
    const st = consultRef.current;
    if (st.id) return st.id;
    if (!st.promise) {
      st.promise = api.createConsultation({ patient_id: st.patientId, motivo: st.motivo || "" })
        .then((c) => { st.id = c.id; setConsultationId(c.id); return c.id; })
        .catch((e) => { st.promise = null; throw e; });
    }
    return st.promise;
  }, []);

  const openPatient = (p, motivo) => beginConsultation(p, motivo);
  const startConsulta = (p, motivo) => beginConsultation(p, motivo);
  const finishConsulta = () => setView("revision");
  const approve = (payload) => { setReviewData(payload || null); setView("imprimir"); };

  // Retomar una consulta YA grabada para revisarla/aprobarla desde el expediente.
  const reviewConsultation = (cid, pat) => {
    if (pat) setPatient(pat);
    setReviewData(null);
    setConsultationId(cid);
    consultRef.current = { id: cid, promise: null, patientId: pat ? pat.id : null };
    setView("revision");
  };

  // Acciones reales expuestas al router de voz (Fase 2). Solo baja sensibilidad.
  const voiceActions = React.useMemo(() => ({
    setView,
    openExpediente: (p) => { setPatient(p); setVoiceFocus({ patient: p, n: Date.now() }); setView("pacientes"); },
    startConsulta: (p) => startConsulta(p),
    goBack: () => volverA(prevViewRef.current || "dashboard"),
    hasActiveConsult: () => !!consultationId || !!consultRef.current.id,
    goRevision: () => setView("revision"),
    getActiveConsultationId: () => consultationId || consultRef.current.id || null,
  }), [consultationId]);

  // Cambio de contraseña voluntario (desde el topbar): pantalla dedicada.
  if (miPerfil) {
    return <MiPerfil onDone={() => { setMiPerfil(false); window.location.reload(); }} onCancel={() => setMiPerfil(false)} />;
  }
  if (changePw) {
    return <ChangePassword onDone={() => setChangePw(false)} onCancel={() => setChangePw(false)} />;
  }

  return (
    <div className="app" data-screen-label={`Megi Medico — ${view}`}>
      {splash && (
        <MegiSplash onDone={() => {
          sessionStorage.setItem("megi.splash.done", "1");
          setSplash(false);
        }} />
      )}
      <Topbar view={view} setView={setView} doctor={DOCTOR} user={user} appVersion={appVersion} onLogout={onLogout} onChangePassword={() => setChangePw(true)} onMiPerfil={() => setMiPerfil(true)} health={health} />
      {/* §4: si la transcripción sería mock o el ASR está caído, avisar antes
          de que alguien documente una consulta sobre texto inventado. */}
      <TranscriptionWarning health={health} />
      <VersionWarning health={health} />

      <ErrorBoundary key={view} onReset={() => setView("dashboard")}>
      {view === "dashboard" && (
        <div data-screen-label="01 Dashboard">
          <Dashboard
            patients={PATIENTS}
            doctor={DOCTOR}
            user={user}
            onOpen={openPatient}
            onStart={startConsulta}
          />
        </div>
      )}
      {view === "estudios" && (
        <EstudiosPaciente
          patient={patient}
          motivo={motivoHoy}
          consultationId={consultationId}
          ensureConsultation={ensureConsultation}
          onContinue={() => setView("consulta")}
          onBack={() => volverA("pacientes")}
        />
      )}
      {view === "consulta" && (
        <div data-screen-label="02 Consulta activa">
          <Consulta
            patient={patient}
            motivo={motivoHoy}
            consultationId={consultationId}
            ensureConsultation={ensureConsultation}
            onBack={() => volverA("dashboard")}
            onFinish={finishConsulta}
            user={user}
            voiceEnabled={voiceEnabled}
          />
        </div>
      )}
      {view === "revision" && (
        <div data-screen-label="03 Revisión">
          <Revision
            patient={patient}
            consultationId={consultationId}
            user={user}
            onBack={() => volverA("consulta")}
            onApprove={approve}
          />
        </div>
      )}
      {view === "imprimir" && (
        <div data-screen-label="04 Imprimir">
          <Imprimir
            patient={patient}
            doctor={DOCTOR}
            consultationId={consultationId}
            reviewData={reviewData}
            onBack={() => volverA("revision")}
          />
        </div>
      )}
      {view === "pacientes" && (
        <div data-screen-label="05 Pacientes">
          <Pacientes onStart={startConsulta} user={user} onReview={reviewConsultation} focusPatient={voiceFocus} />
        </div>
      )}
      {view === "estadisticas" && (
        <div data-screen-label="06 Estadísticas">
          <Estadisticas />
        </div>
      )}
      {view === "guias" && (
        <div data-screen-label="07 Guías clínicas">
          <Guias />
        </div>
      )}
      {view === "radiologia" && (
        <div data-screen-label="10 Radiología">
          <RadiologiaMegi patients={PATIENTS} />
        </div>
      )}
      {view === "anestesio" && (
        <div data-screen-label="09 Anestesio (modelos restringidos)">
          <Anestesio />
        </div>
      )}
      {voiceEnabled && view === "voz" && (
        <div data-screen-label="08 MEGI Voz (prototipo)">
          <MegiVoz />
        </div>
      )}
      {view === "administracion" && user?.role === "admin" && (
        <div data-screen-label="07 Administración">
          <Administracion user={user} />
        </div>
      )}
      </ErrorBoundary>

      {/* local floating opener for preferences (hidden when printing) */}
      <button
        className="no-print"
        onClick={() => setShowTweaks((v) => !v)}
        title="Preferencias (⌘,)"
        style={{
          position: "fixed", right: 16, bottom: 16, zIndex: 40,
          width: 40, height: 40, borderRadius: "50%",
          border: "1px solid var(--hair)", background: "var(--surface)",
          color: "var(--ink-2)", cursor: "pointer", fontSize: 18,
          boxShadow: "0 2px 10px rgba(0,0,0,0.08)",
        }}
      >⚙</button>

      {showTweaks && (
        <Tweaks config={config} setConfig={setConfig} onClose={() => setShowTweaks(false)} />
      )}

      {/* Barra de comandos por voz (Fase 2): navegación y pacientes reales. */}
      {voiceEnabled && <VoiceBar actions={voiceActions} patients={PATIENTS} user={user} />}

      {/* Consultor de fármacos (tipo Drugs.com): dudas de interacciones antes o
          durante la consulta. En consulta/revisión pasa la receta como contexto. */}
      <ConsultorFarmacos rxContext={
        ["consulta", "revision", "imprimir"].includes(view)
          ? (reviewData?.rx_list || []).map((r) => r.drug).filter(Boolean)
          : []
      } />
    </div>
  );
};

// ============ ROOT: login gate + data provider ============
// Sin sesión -> pantalla de login. Con sesión -> se monta el provider (que
// carga config/pacientes) y la app. La sesión persiste en localStorage.
const App = () => {
  const [session, setSession] = useState(() => {
    try { return JSON.parse(localStorage.getItem("megi.session") || "null"); }
    catch (e) { return null; }
  });
  const [selectedVersion, setSelectedVersion] = useState(() => {
    try {
      const s = JSON.parse(localStorage.getItem("megi.session") || "null");
      return isValidAppVersion(s?.app_version) ? s.app_version : null;
    } catch (e) { return null; }
  });

  // P2: ¿falta crear el primer administrador? (null = aún consultando)
  const [needsSetup, setNeedsSetup] = useState(null);

  const handleLogin = (user) => {
    localStorage.setItem("megi.session", JSON.stringify(user));
    setSession(user);
    setSelectedVersion(isValidAppVersion(user?.app_version) ? user.app_version : null);
  };
  const handleLogout = () => {
    // Revoca la sesión en el servidor (el token queda inválido de inmediato) y
    // limpia el estado local sin esperar a la respuesta.
    api.logout();
    localStorage.removeItem("megi.session");
    localStorage.removeItem("megi.view");
    setSession(null);
    setSelectedVersion(null);
  };
  const handleVersionSelect = (versionId) => {
    const id = isValidAppVersion(versionId) ? versionId : defaultAppVersion().id;
    setSession((s) => {
      const next = { ...s, app_version: id };
      localStorage.setItem("megi.session", JSON.stringify(next));
      return next;
    });
    localStorage.setItem("megi.view", getAppVersion(id)?.startView || "dashboard");
    setSelectedVersion(id);
  };
  // Tras cambiar la contraseña forzada: token nuevo, sin el flag.
  const handlePasswordChanged = (token) => {
    setSession((s) => {
      const next = { ...s, must_change_password: false, token: token || s.token };
      localStorage.setItem("megi.session", JSON.stringify(next));
      return next;
    });
  };

  // 401 desde la API (token inválido/expirado) -> cerrar sesión y volver al login.
  useEffect(() => {
    const onUnauth = () => { localStorage.removeItem("megi.session"); setSession(null); setSelectedVersion(null); };
    window.addEventListener("megi:unauthorized", onUnauth);
    return () => window.removeEventListener("megi:unauthorized", onUnauth);
  }, []);

  // Sin sesión: averiguar si es primer arranque (mostrar Setup en vez de Login).
  useEffect(() => {
    if (session) return;
    let alive = true;
    api.setupStatus()
      .then((r) => { if (alive) setNeedsSetup(!!r.needs_setup); })
      .catch(() => { if (alive) setNeedsSetup(false); });
    return () => { alive = false; };
  }, [session]);

  if (!session) {
    if (needsSetup === null) return null;                 // breve carga
    if (needsSetup) return <Setup onReady={handleLogin} />;
    return <Login onLogin={handleLogin} />;
  }

  // Cambio de contraseña obligatorio (usuarios creados por admin) antes de usar la app.
  if (session.must_change_password) {
    return <ChangePassword forced onDone={handlePasswordChanged} />;
  }

  if (!selectedVersion) {
    return <VersionSelect user={session} onSelect={handleVersionSelect} onLogout={handleLogout} />;
  }

  // Ventana dedicada de auditoría (?audit=<consultationId>): vista independiente,
  // sin la navegación de la app, abierta en pestaña nueva desde Pacientes.
  const auditId = new URLSearchParams(window.location.search).get("audit");
  if (auditId) return <ErrorBoundary onReset={() => window.close()}><Audit consultationId={auditId} /></ErrorBoundary>;

  return (
    <MegiDataProvider>
      <AppInner user={session} appVersion={getAppVersion(selectedVersion)} onLogout={handleLogout} />
    </MegiDataProvider>
  );
};

export default App;
