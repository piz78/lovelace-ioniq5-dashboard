/**
 * IONIQ 5 Dashboard Card – Home Assistant Custom Lovelace Card
 * Implementiert mit LitElement (gleiches Framework wie das HA Energy Dashboard)
 *
 * Installation über HACS (empfohlen):
 *   HACS → Frontend → ⋮ → Benutzerdefinierte Repositories →
 *   dieses Repo als "Dashboard" hinzufügen → installieren.
 *   HACS trägt die Ressource automatisch ein.
 *
 * Manuelle Installation:
 *   1. Diesen Ordner nach /config/www/ioniq5-dashboard/ kopieren
 *      (ioniq5-dashboard-card.js, lit-core.min.js, chart.umd.js)
 *   2. HA → Einstellungen → Dashboards → Ressourcen → Hinzufügen
 *      URL:  /local/ioniq5-dashboard/ioniq5-dashboard-card.js   Typ: JavaScript-Modul
 *   3. Browser hart neu laden (Strg+Umschalt+R)
 *
 * Karten-YAML:
 *   type: custom:ioniq5-dashboard-card
 *   entity: sensor.DEIN_SENSOR_NAME
 *   title: IONIQ 5 Fahrdaten     # optional
 */

// Pfade relativ zur eigenen Modul-URL auflösen, statt einen festen Ordner
// anzunehmen. So funktioniert die Card unabhängig davon, ob sie manuell
// oder über HACS (eigener Ordnername pro Repository) installiert wurde.
import { LitElement, html, css, nothing } from "./lit-core.min.js";

// ── Chart.js laden (einmalig, Ergebnis gecacht) ───────────────────────────────
const CHARTJS_URL = new URL('./chart.umd.js', import.meta.url).href;
let _chartJsPromise = null;

function loadChartJS() {
  if (window.Chart) return Promise.resolve();
  if (_chartJsPromise) return _chartJsPromise;
  _chartJsPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = CHARTJS_URL;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Chart.js konnte nicht geladen werden – Internetverbindung prüfen'));
    document.head.appendChild(s);
  });
  return _chartJsPromise;
}

// ── Custom Card ───────────────────────────────────────────────────────────────
class Ioniq5DashboardCard extends LitElement {

  // Reaktive Properties: LitElement löst bei Änderung automatisch ein Re-Render aus
  static properties = {
    hass: { attribute: false }, // Wird von HA bei jedem State-Update gesetzt
  };

  static styles = css`
    :host { display: block; }
    .card-content { padding: 16px; }
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
      gap: 10px;
      margin-bottom: 20px;
    }
    .stat {
      background: var(--secondary-background-color);
      border-radius: 8px;
      padding: 12px;
    }
    .stat-label {
      font-size: 11px;
      color: var(--secondary-text-color);
      margin-bottom: 4px;
    }
    .stat-value {
      font-size: 20px;
      font-weight: 500;
      color: var(--primary-text-color);
    }
    .section-title {
      font-size: 13px;
      font-weight: 500;
      color: var(--primary-text-color);
      margin: 0 0 6px;
    }
    .legend {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      font-size: 12px;
      color: var(--secondary-text-color);
      margin-bottom: 10px;
    }
    .leg-item { display: flex; align-items: center; gap: 5px; }
    .leg-sq   { width: 10px; height: 10px; border-radius: 2px; }
    .leg-ln   { width: 14px; height: 2px; }
    .chart-wrap { position: relative; width: 100%; }
    .divider {
      border: none;
      border-top: 1px solid var(--divider-color, rgba(0,0,0,.12));
      margin: 20px 0;
    }
    .error { color: var(--error-color, red); font-size: 13px; padding: 4px 0; }
  `;

  constructor() {
    super();
    this._config      = null;
    this._chart1      = null;
    this._chart2      = null;
    // _data und _stats sind plain fields (nicht reaktiv) –
    // sie werden in willUpdate() berechnet und in render() gelesen.
    this._data        = [];
    this._stats       = null;
    this._lastHash    = null;
    this._pendingData = null;
    this._error       = null;
    // Nur true, wenn sich die Fahrdaten seit dem letzten Render wirklich
    // geändert haben (siehe willUpdate). Verhindert, dass updated() die
    // Charts bei jedem hass-Tick (z.B. GPS/Sensor-Updates der iOS App)
    // unnötig zerstört und neu aufbaut.
    this._dataChanged = false;

    // ResizeObserver: Charts erst rendern, wenn die Card tatsächlich
    // eine Breite hat – löst das Problem mit HA-Unterseiten.
    this._resizeObserver = new ResizeObserver(() => {
      if (!this._pendingData) return;
      const canvas = this.shadowRoot?.querySelector('#chart1');
      if (canvas && canvas.offsetWidth > 0) {
        const d = this._pendingData;
        this._pendingData = null;
        this._renderCharts(d);
      }
    });
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  connectedCallback() {
    super.connectedCallback();
    this._resizeObserver.observe(this);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._resizeObserver.disconnect();
    this._destroyCharts();
    // Hash zurücksetzen: erzwingt Neuaufbau wenn dieselbe Instanz
    // durch HA-Navigation wieder eingeblendet wird
    this._lastHash    = null;
    this._pendingData = null;
  }

  // ── Card-Konfiguration (von HA aufgerufen) ────────────────────────────────
  setConfig(config) {
    if (!config.entity) throw new Error('"entity" muss angegeben werden');
    this._config = config;
    this.requestUpdate(); // manuell, da _config kein reaktives Property ist
  }

  getCardSize() { return 7; }

  // ── willUpdate: Daten berechnen VOR dem Rendern ───────────────────────────
  // Läuft synchron vor render(). Setzt keine reaktiven Properties
  // → kein zusätzlicher Render-Zyklus.
  willUpdate(changedProps) {
    if (!changedProps.has('hass') || !this.hass || !this._config) return;

    const entity = this.hass.states[this._config.entity];
    if (!entity) return;

    const hash = JSON.stringify(entity.attributes);
    if (hash === this._lastHash) return;
    this._lastHash = hash;

    this._data        = this._parseData(entity.attributes);
    this._stats       = this._data.length ? this._computeStats(this._data) : null;
    this._dataChanged = true;
  }

  // ── updated: Imperative Chart-Logik NACH dem Rendern ─────────────────────
  // Canvas-Elemente sind hier garantiert im Shadow DOM vorhanden.
  // Läuft bei jedem hass-Update, baut die Charts aber nur neu auf, wenn sich
  // die Fahrdaten tatsächlich geändert haben (_dataChanged), nicht bei jedem
  // hass-Tick (sonst werden die Charts z.B. in der iOS-App durch häufige
  // GPS-/Sensor-Updates ständig zerstört und neu aufgebaut).
  async updated(changedProps) {
    if (!this._dataChanged || !this._data?.length) return;
    this._dataChanged = false;

    try {
      await loadChartJS();
    } catch (e) {
      this._error = e.message;
      this.requestUpdate();
      return;
    }

    this._buildCharts(this._data);
  }

  // ── Template ──────────────────────────────────────────────────────────────
  render() {
    const s = this._stats;
    return html`
      <ha-card .header=${this._config?.title}>
        <div class="card-content">

          ${this._error
            ? html`<p class="error">${this._error}</p>`
            : nothing}

          <div class="stats">
            <div class="stat">
              <div class="stat-label">Gesamtstrecke</div>
              <div class="stat-value">${s?.km    ?? '—'}</div>
            </div>
            <div class="stat">
              <div class="stat-label">Verbraucht</div>
              <div class="stat-value">${s?.kwh   ?? '—'}</div>
            </div>
            <div class="stat">
              <div class="stat-label">Rekuperiert</div>
              <div class="stat-value">${s?.regen ?? '—'}</div>
            </div>
            <div class="stat">
              <div class="stat-label">Ø Effizienz (netto)</div>
              <div class="stat-value">${s?.eff   ?? '—'}</div>
            </div>
          </div>

          <p class="section-title">Energieverbrauch &amp; Rekuperation</p>
          <div class="legend">
            <span class="leg-item"><span class="leg-sq" style="background:#378ADD"></span>Antrieb</span>
            <span class="leg-item"><span class="leg-sq" style="background:#EF9F27"></span>Klima</span>
            <span class="leg-item"><span class="leg-sq" style="background:#7F77DD"></span>Elektronik</span>
            <span class="leg-item"><span class="leg-ln" style="background:#1D9E75"></span>Rekuperiert</span>
          </div>
          <div class="chart-wrap" style="height:280px">
            <canvas id="chart1"></canvas>
          </div>

          <hr class="divider">

          <p class="section-title">Strecke &amp; Netto-Effizienz</p>
          <div class="legend">
            <span class="leg-item"><span class="leg-sq" style="background:rgba(16,185,129,0.75)"></span>Strecke km (links)</span>
            <span class="leg-item"><span class="leg-ln" style="background:#378ADD"></span>Effizienz kWh/100km (rechts)</span>
          </div>
          <div class="chart-wrap" style="height:220px">
            <canvas id="chart2"></canvas>
          </div>

        </div>
      </ha-card>
    `;
  }

  // ── Datenverarbeitung ──────────────────────────────────────────────────────
  _parseData(attributes) {
    return Object.entries(attributes)
      .filter(([k]) => /^\d{4}-\d{2}-\d{2}$/.test(k))
      .map(([date, v]) => {
        const total = v.total_consumed      || 0;
        const regen = v.regenerated_energy  || 0;
        const dist  = v.distance            || 0;
        const net   = Math.max(0, total - regen);
        return {
          date,
          label:    new Date(date + 'T12:00:00').toLocaleDateString('de', { day: 'numeric', month: 'short' }),
          engine:   v.engine_consumption              || 0,
          climate:  v.climate_consumption             || 0,
          onboard:  v.onboard_electronics_consumption || 0,
          regen, distance: dist, total, net,
          efficiency: dist > 0 ? parseFloat((net / dist / 10).toFixed(2)) : null,
        };
      })
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  _computeStats(data) {
    const km    = data.reduce((s, d) => s + d.distance, 0);
    const wh    = data.reduce((s, d) => s + d.total,    0);
    const regen = data.reduce((s, d) => s + d.regen,    0);
    const net   = data.reduce((s, d) => s + d.net,      0);
    const eff   = km > 0 ? (net / km / 10).toFixed(1) : null;
    return {
      km:    Math.round(km) + ' km',
      kwh:   (wh    / 1000).toFixed(1) + ' kWh',
      regen: (regen / 1000).toFixed(1) + ' kWh',
      eff:   eff ? eff + ' kWh/100km' : '—',
    };
  }

  _themeColors() {
    const cs = window.getComputedStyle(this);
    return {
      tc: cs.getPropertyValue('--secondary-text-color').trim() || '#888',
      gc: cs.getPropertyValue('--divider-color').trim()        || 'rgba(0,0,0,0.1)',
    };
  }

  // ── Chart-Management ───────────────────────────────────────────────────────
  _destroyCharts() {
    this._chart1?.destroy(); this._chart1 = null;
    this._chart2?.destroy(); this._chart2 = null;
  }

  // Prüft ob Canvas sichtbar ist – verschiebt Rendering per ResizeObserver falls nicht
  _buildCharts(data) {
    this._destroyCharts();
    const canvas = this.shadowRoot?.querySelector('#chart1');
    if (!canvas || canvas.offsetWidth === 0) {
      this._pendingData = data;
      return;
    }
    this._pendingData = null;
    this._renderCharts(data);
  }

  // Erstellt die Chart.js-Instanzen (nur aufrufen wenn canvas.offsetWidth > 0)
  _renderCharts(data) {
    const { tc, gc } = this._themeColors();
    const sr   = this.shadowRoot;
    const lbl  = data.map(d => d.label);
    const base = {
      grid:  { color: gc },
      ticks: { color: tc, font: { size: 11 } },
    };

    // ── Chart 1: Gestapelte Balken (Verbrauch) + Linie (Rekuperation) ────────
    this._chart1 = new Chart(sr.querySelector('#chart1'), {
      type: 'bar',
      data: {
        labels: lbl,
        datasets: [
          { label: 'Antrieb',    data: data.map(d => d.engine),  backgroundColor: '#378ADD', stack: 'a', order: 1 },
          { label: 'Klima',      data: data.map(d => d.climate), backgroundColor: '#EF9F27', stack: 'a', order: 1 },
          { label: 'Elektronik', data: data.map(d => d.onboard), backgroundColor: '#7F77DD', stack: 'a', order: 1 },
          {
            type: 'line', label: 'Rekuperiert',
            data: data.map(d => d.regen),
            borderColor: '#1D9E75', backgroundColor: 'transparent',
            borderWidth: 2, borderDash: [6, 3],
            pointRadius: 3, pointBackgroundColor: '#1D9E75', pointBorderWidth: 0, tension: 0.3,
            order: 0, // order 0 = nach Balken (order 1) gezeichnet = im Vordergrund
          },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            mode: 'index',
            intersect: false,
            callbacks: {
              label: ctx => `  ${ctx.dataset.label}: ${(ctx.parsed.y / 1000).toFixed(2)} kWh`,
              footer: items => {
                if (!items.length) return [];
                const day = data[items[0].dataIndex];
                if (!day) return [];
                const eff = day.efficiency != null ? day.efficiency.toFixed(1) + ' kWh/100km' : '—';
                return [
                  '──────────────────────',
                  `Gesamt:    ${(day.total / 1000).toFixed(2)} kWh`,
                  `Netto:     ${(day.net   / 1000).toFixed(2)} kWh`,
                  `Strecke:   ${day.distance} km`,
                  `Effizienz: ${eff}`,
                ];
              },
            },
          },
        },
        scales: {
          x: { stacked: true, ...base },
          y: { stacked: true, ...base, ticks: { ...base.ticks, callback: v => Math.round(v / 1000) + 'k' } },
        },
      },
    });

    // ── Chart 2: Strecke (Balken) + Effizienz (Linie, rechte Achse) ──────────
    this._chart2 = new Chart(sr.querySelector('#chart2'), {
      type: 'bar',
      data: {
        labels: lbl,
        datasets: [
          {
            label: 'Strecke',
            data: data.map(d => d.distance),
            backgroundColor: 'rgba(16,185,129,0.75)', borderRadius: 3, yAxisID: 'ykm',
          },
          {
            type: 'line', label: 'Effizienz',
            data: data.map(d => d.efficiency),
            borderColor: '#378ADD', backgroundColor: 'transparent',
            borderWidth: 2.5, pointRadius: 4, pointBackgroundColor: '#378ADD', pointBorderWidth: 0,
            tension: 0.3, spanGaps: false, yAxisID: 'yeff',
          },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            mode: 'index',
            intersect: false,
            callbacks: {
              label: ctx => ctx.dataset.label === 'Effizienz'
                ? (ctx.parsed.y != null ? `  Effizienz: ${ctx.parsed.y.toFixed(1)} kWh/100km` : '  Kein Antrieb')
                : `  Strecke: ${ctx.parsed.y} km`,
            },
          },
        },
        scales: {
          x:    { ...base },
          ykm:  { position: 'left',  ...base, ticks: { ...base.ticks, callback: v => v + ' km' }, min: 0 },
          yeff: {
            position: 'right', grid: { drawOnChartArea: false },
            ticks: { color: tc, font: { size: 11 }, callback: v => v.toFixed(1) },
            min: 0,
            title: { display: true, text: 'kWh/100km', color: tc, font: { size: 11 } },
          },
        },
      },
    });
  }
}

customElements.define('ioniq5-dashboard-card', Ioniq5DashboardCard);
