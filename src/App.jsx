import { useState, useEffect, useCallback } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine
} from "recharts";

// ─── USGS Water Services API ────────────────────────────────────────────────
const USGS_BASE = "https://waterservices.usgs.gov/nwis";

async function searchStations(query) {
  const isState = query.trim().length === 2 && /^[a-zA-Z]+$/.test(query.trim());
  let url;
  if (isState) {
    url = `${USGS_BASE}/iv/?format=json&stateCd=${query.trim().toLowerCase()}&parameterCd=00060,00065&siteStatus=active&siteType=ST&period=PT1H`;
  } else {
    url = `${USGS_BASE}/site/?format=rdb&siteNameMatchOperator=contains&siteName=${encodeURIComponent(query)}&siteType=ST,LK&siteStatus=active&outputDataTypeCd=iv`;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to fetch stations");

  if (isState) {
    const data = await res.json();
    const seen = new Set();
    return data.value.timeSeries
      .map(ts => ({
        id: ts.sourceInfo.siteCode[0].value,
        name: ts.sourceInfo.siteName,
        lat: ts.sourceInfo.geoLocation?.geogLocation?.latitude,
        lon: ts.sourceInfo.geoLocation?.geogLocation?.longitude,
      }))
      .filter(s => {
        if (seen.has(s.id)) return false;
        seen.add(s.id);
        return true;
      })
      .slice(0, 20);
  } else {
    const text = await res.text();
    const lines = text.split("\n").filter(l => !l.startsWith("#") && l.trim());
    const dataLines = lines.slice(2);
    return dataLines
      .map(line => {
        const cols = line.split("\t");
        return cols.length >= 3 ? { id: cols[1], name: cols[2], lat: cols[4], lon: cols[5] } : null;
      })
      .filter(Boolean)
      .slice(0, 20);
  }
}

async function fetchStationData(siteId, period = "P7D") {
  const url = `${USGS_BASE}/iv/?format=json&sites=${siteId}&parameterCd=00060,00065&period=${period}&siteStatus=active`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to fetch station data");
  const data = await res.json();

  const result = { flow: null, gauge: null, siteName: "", siteId };

  for (const ts of data.value.timeSeries) {
    const code = ts.variable.variableCode[0].value;
    const name = ts.variable.variableName;
    const unit = ts.variable.unit.unitCode;
    const values = ts.values[0].value
      .filter(v => v.value !== "-999999")
      .map(v => ({
        time: new Date(v.dateTime).getTime(),
        label: formatTime(new Date(v.dateTime)),
        value: parseFloat(v.value),
      }));

    result.siteName = ts.sourceInfo.siteName;

    if (code === "00060") result.flow = { values, name, unit };
    if (code === "00065") result.gauge = { values, name, unit };
  }

  // flood stage from USGS site service
  try {
    const stageRes = await fetch(
      `https://waterservices.usgs.gov/nwis/site/?format=rdb&sites=${siteId}&seriesCatalogOutput=true`
    );
    if (stageRes.ok) {
      // just use a rough heuristic if not available
    }
  } catch (_) {}

  return result;
}

function formatTime(date) {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
    " " + date.toLocaleTimeString("en-US", { hour: "numeric", hour12: true });
}

// ─── Flood Stage Classification ──────────────────────────────────────────────
function classifyGauge(val, history) {
  if (!val || !history?.length) return { label: "Unknown", color: "#64748b" };
  const max = Math.max(...history.map(h => h.value));
  const pct = val / max;
  if (pct > 0.9) return { label: "Flood Risk", color: "#ef4444", bg: "#fef2f2" };
  if (pct > 0.7) return { label: "Elevated", color: "#f59e0b", bg: "#fffbeb" };
  if (pct > 0.4) return { label: "Normal", color: "#22c55e", bg: "#f0fdf4" };
  return { label: "Low", color: "#3b82f6", bg: "#eff6ff" };
}

// ─── Trend Arrow ─────────────────────────────────────────────────────────────
function getTrend(values) {
  if (!values || values.length < 6) return null;
  const recent = values.slice(-6).map(v => v.value);
  const first = recent[0], last = recent[recent.length - 1];
  const pct = ((last - first) / (Math.abs(first) || 1)) * 100;
  if (pct > 5) return { dir: "rising", arrow: "↑", color: "#f59e0b" };
  if (pct < -5) return { dir: "falling", arrow: "↓", color: "#3b82f6" };
  return { dir: "stable", arrow: "→", color: "#22c55e" };
}

// ─── Chart Tooltip ───────────────────────────────────────────────────────────
function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: "#0f172a", border: "1px solid #1e293b",
      borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#e2e8f0"
    }}>
      <div style={{ color: "#64748b", marginBottom: 4, fontSize: 11 }}>{label}</div>
      <div style={{ color: "#38bdf8", fontWeight: 700, fontSize: 16 }}>
        {payload[0].value?.toFixed(2)} <span style={{ fontSize: 11, color: "#64748b" }}>{payload[0].name}</span>
      </div>
    </div>
  );
}

// ─── Stat Card ───────────────────────────────────────────────────────────────
function StatCard({ label, value, unit, trend, status }) {
  return (
    <div style={{
      background: "#0f172a", border: "1px solid #1e293b", borderRadius: 12,
      padding: "20px 24px", flex: 1, minWidth: 160
    }}>
      <div style={{ fontSize: 11, color: "#475569", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ fontSize: 32, fontWeight: 800, color: "#f1f5f9", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
        {value ?? "—"}
        <span style={{ fontSize: 14, color: "#475569", fontWeight: 400, marginLeft: 6 }}>{unit}</span>
      </div>
      <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center" }}>
        {trend && (
          <span style={{ color: trend.color, fontSize: 13, fontWeight: 600 }}>
            {trend.arrow} {trend.dir}
          </span>
        )}
        {status && (
          <span style={{
            background: status.bg, color: status.color,
            borderRadius: 20, padding: "2px 10px", fontSize: 11, fontWeight: 700
          }}>
            {status.label}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Chart Panel ─────────────────────────────────────────────────────────────
function ChartPanel({ title, data, unit, color, refLine }) {
  if (!data?.length) return null;
  const thinned = data.filter((_, i) => i % Math.max(1, Math.floor(data.length / 120)) === 0);

  return (
    <div style={{
      background: "#0f172a", border: "1px solid #1e293b", borderRadius: 12,
      padding: "24px 24px 16px"
    }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: "#94a3b8", marginBottom: 20, letterSpacing: "0.04em" }}>
        {title}
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={thinned} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis dataKey="label" tick={{ fill: "#475569", fontSize: 10 }} interval="preserveStartEnd" tickLine={false} />
          <YAxis tick={{ fill: "#475569", fontSize: 11 }} tickLine={false} axisLine={false} width={52} />
          <Tooltip content={<CustomTooltip />} />
          {refLine && <ReferenceLine y={refLine} stroke="#ef4444" strokeDasharray="4 4" label={{ value: "high", fill: "#ef4444", fontSize: 10 }} />}
          <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2} dot={false} name={unit} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Search Result Row ───────────────────────────────────────────────────────
function StationRow({ station, onSelect }) {
  return (
    <button onClick={() => onSelect(station)} style={{
      width: "100%", textAlign: "left", background: "none", border: "none",
      padding: "12px 16px", cursor: "pointer", borderBottom: "1px solid #1e293b",
      transition: "background 0.15s"
    }}
      onMouseEnter={e => e.currentTarget.style.background = "#1e293b"}
      onMouseLeave={e => e.currentTarget.style.background = "none"}
    >
      <div style={{ fontSize: 13, color: "#e2e8f0", fontWeight: 500 }}>{station.name}</div>
      <div style={{ fontSize: 11, color: "#475569", marginTop: 2 }}>Site #{station.id}</div>
    </button>
  );
}

// ─── Period Selector ─────────────────────────────────────────────────────────
const PERIODS = [
  { label: "24h", value: "P1D" },
  { label: "7d", value: "P7D" },
  { label: "30d", value: "P30D" },
];

// ─── POPULAR STATIONS ─────────────────────────────────────────────────────────
const POPULAR = [
  { id: "08158000", name: "Colorado River at Austin, TX" },
  { id: "07374000", name: "Mississippi River at Baton Rouge, LA" },
  { id: "14211720", name: "Willamette River at Portland, OR" },
  { id: "09380000", name: "Colorado River at Lees Ferry, AZ" },
  { id: "01646500", name: "Potomac River near Washington, DC" },
];

// ─── MAIN APP ────────────────────────────────────────────────────────────────
export default function App() {
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState([]);
  const [searchError, setSearchError] = useState("");

  const [station, setStation] = useState(null);
  const [stationData, setStationData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [period, setPeriod] = useState("P7D");

  const handleSearch = useCallback(async () => {
    if (!query.trim()) return;
    setSearching(true);
    setSearchError("");
    setResults([]);
    try {
      const res = await searchStations(query);
      setResults(res);
      if (!res.length) setSearchError("No active stations found. Try a state abbreviation (e.g. TX) or river name.");
    } catch (e) {
      setSearchError("Search failed: " + e.message);
    } finally {
      setSearching(false);
    }
  }, [query]);

  const handleSelect = useCallback(async (s, p = period) => {
    setStation(s);
    setResults([]);
    setQuery("");
    setLoading(true);
    setError("");
    setStationData(null);
    try {
      const data = await fetchStationData(s.id, p);
      setStationData(data);
    } catch (e) {
      setError("Could not load data for this station: " + e.message);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    if (station) handleSelect(station, period);
  }, [period]); // eslint-disable-line

  const latest = {
    flow: stationData?.flow?.values?.slice(-1)[0]?.value,
    gauge: stationData?.gauge?.values?.slice(-1)[0]?.value,
  };
  const flowTrend = getTrend(stationData?.flow?.values);
  const gaugeTrend = getTrend(stationData?.gauge?.values);
  const gaugeStatus = classifyGauge(latest.gauge, stationData?.gauge?.values);

  return (
    <div style={{
      minHeight: "100vh", background: "#020817", color: "#e2e8f0",
      fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif"
    }}>

      {/* Header */}
      <div style={{
        borderBottom: "1px solid #1e293b", padding: "0 32px",
        display: "flex", alignItems: "center", height: 60, gap: 16
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <path d="M4 20 Q7 14 14 16 Q21 18 24 10" stroke="#38bdf8" strokeWidth="2.5" strokeLinecap="round" fill="none"/>
            <path d="M4 22 Q8 17 14 19 Q20 21 24 14" stroke="#0ea5e9" strokeWidth="1.5" strokeLinecap="round" fill="none" opacity="0.5"/>
          </svg>
          <span style={{ fontWeight: 800, fontSize: 18, color: "#f1f5f9", letterSpacing: "-0.02em" }}>HydroWatch</span>
        </div>
        <span style={{ fontSize: 12, color: "#334155", borderLeft: "1px solid #1e293b", paddingLeft: 16 }}>
          Live river & lake monitoring · USGS Water Services
        </span>
        <div style={{ marginLeft: "auto" }}>
          <a href="https://waterservices.usgs.gov" target="_blank" rel="noreferrer"
            style={{ fontSize: 11, color: "#475569", textDecoration: "none" }}>
            Data: USGS NWIS ↗
          </a>
        </div>
      </div>

      <div style={{ maxWidth: 960, margin: "0 auto", padding: "32px 24px" }}>

        {/* Search */}
        <div style={{ marginBottom: 32 }}>
          <div style={{ fontSize: 13, color: "#64748b", marginBottom: 10 }}>
            Search by river/lake name or enter a 2-letter state code (e.g. <code style={{ color: "#38bdf8" }}>TX</code>, <code style={{ color: "#38bdf8" }}>LA</code>)
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleSearch()}
              placeholder="Colorado River, Mississippi, TX ..."
              style={{
                flex: 1, background: "#0f172a", border: "1px solid #1e293b",
                borderRadius: 8, padding: "10px 16px", fontSize: 14,
                color: "#e2e8f0", outline: "none", fontFamily: "inherit"
              }}
            />
            <button onClick={handleSearch} disabled={searching || !query.trim()} style={{
              background: "#0ea5e9", color: "#fff", border: "none", borderRadius: 8,
              padding: "10px 22px", fontSize: 14, fontWeight: 600, cursor: "pointer",
              opacity: searching || !query.trim() ? 0.5 : 1, fontFamily: "inherit"
            }}>
              {searching ? "Searching…" : "Search"}
            </button>
          </div>
          {searchError && <div style={{ color: "#f87171", fontSize: 13, marginTop: 8 }}>{searchError}</div>}

          {/* Results */}
          {results.length > 0 && (
            <div style={{
              marginTop: 6, background: "#0f172a", border: "1px solid #1e293b",
              borderRadius: 10, overflow: "hidden", maxHeight: 300, overflowY: "auto"
            }}>
              {results.map(r => <StationRow key={r.id} station={r} onSelect={handleSelect} />)}
            </div>
          )}
        </div>

        {/* Popular Stations */}
        {!station && (
          <div>
            <div style={{ fontSize: 11, color: "#475569", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>
              Popular Stations
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {POPULAR.map(p => (
                <button key={p.id} onClick={() => handleSelect(p)} style={{
                  background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8,
                  padding: "8px 16px", fontSize: 13, color: "#94a3b8", cursor: "pointer",
                  fontFamily: "inherit", transition: "all 0.15s"
                }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = "#38bdf8"; e.currentTarget.style.color = "#38bdf8"; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = "#1e293b"; e.currentTarget.style.color = "#94a3b8"; }}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Station Dashboard */}
        {station && (
          <div>
            {/* Station Header */}
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
              <div>
                <div style={{ fontSize: 11, color: "#475569", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>
                  Active Station · #{station.id}
                </div>
                <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "#f1f5f9", letterSpacing: "-0.02em" }}>
                  {stationData?.siteName || station.name}
                </h1>
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                {PERIODS.map(p => (
                  <button key={p.value} onClick={() => setPeriod(p.value)} style={{
                    background: period === p.value ? "#0ea5e9" : "#0f172a",
                    color: period === p.value ? "#fff" : "#64748b",
                    border: "1px solid " + (period === p.value ? "#0ea5e9" : "#1e293b"),
                    borderRadius: 6, padding: "5px 12px", fontSize: 12, fontWeight: 600,
                    cursor: "pointer", fontFamily: "inherit"
                  }}>
                    {p.label}
                  </button>
                ))}
                <button onClick={() => { setStation(null); setStationData(null); }} style={{
                  background: "none", border: "1px solid #1e293b", borderRadius: 6,
                  color: "#475569", padding: "5px 12px", fontSize: 12, cursor: "pointer",
                  fontFamily: "inherit", marginLeft: 8
                }}>
                  ✕ Clear
                </button>
              </div>
            </div>

            {loading && (
              <div style={{ textAlign: "center", padding: "60px 0", color: "#475569" }}>
                <div style={{ fontSize: 24, marginBottom: 12 }}>⟳</div>
                Fetching live gauge data…
              </div>
            )}

            {error && (
              <div style={{ background: "#1c0a0a", border: "1px solid #7f1d1d", borderRadius: 10, padding: "16px 20px", color: "#f87171" }}>
                {error}
              </div>
            )}

            {stationData && !loading && (
              <div>
                {/* Stat Cards */}
                <div style={{ display: "flex", gap: 16, marginBottom: 20, flexWrap: "wrap" }}>
                  <StatCard
                    label="Stream Flow"
                    value={latest.flow?.toLocaleString()}
                    unit={stationData.flow?.unit || "ft³/s"}
                    trend={flowTrend}
                  />
                  <StatCard
                    label="Gauge Height"
                    value={latest.gauge?.toFixed(2)}
                    unit={stationData.gauge?.unit || "ft"}
                    trend={gaugeTrend}
                    status={gaugeStatus}
                  />
                  <div style={{
                    background: "#0f172a", border: "1px solid #1e293b", borderRadius: 12,
                    padding: "20px 24px", flex: 1, minWidth: 160
                  }}>
                    <div style={{ fontSize: 11, color: "#475569", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
                      Data Source
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "#94a3b8" }}>USGS NWIS</div>
                    <div style={{ fontSize: 11, color: "#475569", marginTop: 6 }}>
                      {stationData.flow?.values?.length || 0} readings · {period === "P1D" ? "24 hours" : period === "P7D" ? "7 days" : "30 days"}
                    </div>
                    <div style={{ fontSize: 11, color: "#475569", marginTop: 4 }}>
                      Updated: {new Date().toLocaleTimeString()}
                    </div>
                  </div>
                </div>

                {/* Charts */}
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  {stationData.flow && (
                    <ChartPanel
                      title="STREAM FLOW (ft³/s)"
                      data={stationData.flow.values}
                      unit="ft³/s"
                      color="#38bdf8"
                    />
                  )}
                  {stationData.gauge && (
                    <ChartPanel
                      title="GAUGE HEIGHT (ft)"
                      data={stationData.gauge.values}
                      unit="ft"
                      color="#818cf8"
                    />
                  )}
                </div>

                {/* No data message */}
                {!stationData.flow && !stationData.gauge && (
                  <div style={{ textAlign: "center", padding: "40px", color: "#475569" }}>
                    This station doesn't report flow or gauge data for the selected period.
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div style={{ marginTop: 60, borderTop: "1px solid #0f172a", paddingTop: 20, fontSize: 11, color: "#334155", textAlign: "center" }}>
          Built with USGS National Water Information System (NWIS) · Public domain data · No API key required ·{" "}
          <a href="https://waterservices.usgs.gov/docs/" target="_blank" rel="noreferrer" style={{ color: "#38bdf8", textDecoration: "none" }}>
            API Docs ↗
          </a>
        </div>

      </div>
    </div>
  );
}
