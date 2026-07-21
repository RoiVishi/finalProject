import React, { useMemo, useState } from 'react';
import DigitalTwin, { DEMO_ZONES, zonesFor } from './DigitalTwin.jsx';
import RealisticTwin from './RealisticTwin.jsx';
import RoomView from './RoomView.jsx';
import { PROJECTS } from './projects.js';
import './theme.css';

const riskColors = { low: 'var(--success)', medium: 'var(--warning)', high: 'var(--danger)', done: 'var(--muted)' };
const riskLabel = (r) => (r === 'high' ? 'גבוה' : r === 'medium' ? 'בינוני' : r === 'done' ? '—' : 'נמוך');
const statusChipClass = (s) => (s === 'הושלם' ? 'ok' : s === 'בתהליך' ? 'warn' : 'muted');

export default function App() {
  const [project, setProject] = useState(PROJECTS[0]);
  const [selected, setSelected] = useState(null);
  const [realistic, setRealistic] = useState(false);
  const [inRoom, setInRoom] = useState(false);
  const [fade, setFade] = useState(false);
  const zones = useMemo(() => zonesFor(project), [project]);

  /** fade-to-black transition when entering/exiting a room */
  const withFade = (fn) => {
    setFade(true);
    setTimeout(() => {
      fn();
      setFade(false);
    }, 380);
  };

  const pick = (p) => {
    setProject(p);
    setSelected(null);
    setInRoom(false);
  };

  const riskPct = selected?.prob != null ? Math.round(selected.prob * 100) : null;

  return (
    <div className="app-shell" dir="rtl">
      <div className="viewport">
        {inRoom && selected ? (
          <RoomView
            zone={selected}
            zones={zones}
            onNavigate={setSelected}
            onExit={() => withFade(() => setInRoom(false))}
          />
        ) : realistic && project.model ? (
          <RealisticTwin spec={project} selected={selected} onSelect={setSelected} />
        ) : (
          <DigitalTwin spec={project} selected={selected} onSelect={setSelected} />
        )}

        {/* transition overlay */}
        <div
          style={{
            position: 'absolute', inset: 0, background: '#000', pointerEvents: 'none',
            opacity: fade ? 1 : 0, transition: 'opacity 380ms ease', zIndex: 5,
          }}
        />

        {!inRoom && (
          <div className="glass-chips">
            {PROJECTS.some((p) => p.model) && (
              <button
                className={`glass-chip ${realistic ? 'active' : ''}`}
                onClick={() => setRealistic(!realistic)}
                disabled={!project.model}
                title={project.model ? '' : 'אין עדיין מודל תלת־ממדי לבניין זה'}
              >
                {realistic ? 'מבט סכמטי' : 'מבט ריאליסטי (AI)'}
              </button>
            )}
            {PROJECTS.map((p) => (
              <button
                key={p.id}
                className={`glass-chip ${p.id === project.id ? 'active' : ''}`}
                onClick={() => pick(p)}
              >
                {p.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <aside className="sidebar">
        <div className="app-header">
          <div className="logo-mark">🏗️</div>
          <div>
            <div className="app-title">תאום דיגיטלי</div>
            <div className="app-subtitle">ניהול פרויקטי בנייה · חיזוי עיכובים AI</div>
          </div>
        </div>

        <div className="card">
          <div className="card-title">{project.name}</div>
          <div className="card-caption">{project.architect}</div>
          <div className="thumbs">
            <figure>
              <img src={project.photo} alt="תמונת הפרויקט האמיתי" />
              <figcaption>הפרויקט האמיתי</figcaption>
            </figure>
            <figure>
              <img src={project.plan} alt="תוכנית / הדמיה" />
              <figcaption>תוכנית / הדמיית מקור</figcaption>
            </figure>
          </div>
          <a href={project.source} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>
            מקור: ArchDaily ↗
          </a>
        </div>

        {selected ? (
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div className="eyebrow">אזור נבחר</div>
                <div className="card-title" style={{ marginTop: 4 }}>{selected.label}</div>
              </div>
              <span className={`chip ${statusChipClass(selected.status)}`}>
                <span className="chip-dot" />
                {selected.status}
              </span>
            </div>

            {riskPct != null && (
              <div>
                <div className="risk-row">
                  <span style={{ fontSize: 12, fontWeight: 600 }}>סיכון עיכוב חזוי</span>
                  <span className="risk-value" style={{ color: riskColors[selected.risk] }}>
                    {riskPct}% · {riskLabel(selected.risk)}
                  </span>
                </div>
                <div className="risk-track">
                  <div className="risk-gradient" />
                  <div className="risk-fill" style={{ width: `${riskPct}%` }} />
                  <div
                    className="risk-knob"
                    style={{ right: `calc(${riskPct}% - 8px)`, borderColor: riskColors[selected.risk] }}
                  />
                </div>
                <div className="risk-scale">
                  <span>נמוך</span>
                  <span>בינוני</span>
                  <span>קריטי</span>
                </div>
              </div>
            )}

            {!inRoom && (
              <button className="cta" onClick={() => withFade(() => setInRoom(true))}>
                <span>🚪</span>
                <span>כניסה לחדר (360°)</span>
              </button>
            )}
            {inRoom && (
              <button className="back-btn" onClick={() => withFade(() => setInRoom(false))}>
                ← חזרה למבט הבניין
              </button>
            )}

            <div>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>משימות באזור</div>
              <ul className="task-list">
                {selected.tasks.map((t) => {
                  const blocked = t.includes('חסום');
                  return (
                    <li key={t} className={blocked ? 'blocked' : ''}>
                      <span className="task-dot" />
                      <span>{t}</span>
                      {blocked && <span className="badge-blocked">חסום</span>}
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        ) : (
          <div className="card">
            <p className="hint" style={{ margin: 0 }}>
              בחר אזור בבניין כדי לראות סטטוס, סיכון עיכוב חזוי ומשימות — ולהיכנס אל החדר ב-360°.
            </p>
          </div>
        )}

        <div className="footer-note">
          ההדמיה נבנית אוטומטית ממפרט הפרויקט; סיכוני העיכוב יגיעו משירות ה-AI (דמו). © 2026
        </div>
      </aside>
    </div>
  );
}

export { DEMO_ZONES };
