import { useState, useEffect, useRef } from "react";
import { MapContainer, TileLayer, CircleMarker, Tooltip, Polygon, useMap, ZoomControl } from "react-leaflet";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartTooltip, ResponsiveContainer } from "recharts";
import "leaflet/dist/leaflet.css";

const USGS      = "https://waterservices.usgs.gov/nwis";
const NOMINATIM = "https://nominatim.openstreetmap.org";
const OVERPASS  = "https://overpass-api.de/api/interpreter";
const WEATHER   = "https://api.open-meteo.com/v1/forecast";
const CORPS_URLS = [
  "https://water.usace.army.mil/a2w/CWMS_CRREL.cwms_data_api.get_lake_summary_json?p_district_id=17&p_source=USACE&p_unit_system=EN&p_format=CSV",
  "https://water.usace.army.mil/a2w/CWMS_CRREL.cwms_data_api.get_lake_summary_json?p_district_id=12&p_source=USACE&p_unit_system=EN&p_format=CSV",
];

const POPULAR_LAKES = [
  { name: "Lake Travis",    state: "TX" },
  { name: "Lake Conroe",    state: "TX" },
  { name: "Canyon Lake",    state: "TX" },
  { name: "Lake Tahoe",     state: "CA/NV" },
  { name: "Lake Texoma",    state: "TX/OK" },
  { name: "Grapevine Lake", state: "TX" },
  { name: "Lake Cumberland",state: "KY" },
  { name: "Lake Lanier",    state: "GA" },
];

// ── API Helpers ───────────────────────────────────────────────────────────────
async function geocodeLake(query) {
  const res = await fetch(`${NOMINATIM}/search?q=${encodeURIComponent(query)}&format=json&limit=6`, {
    headers: { "Accept-Language": "en" }
  });
  return res.json();
}

async function fetchLakePolygon(osmId, osmType) {
  let query;
  if (osmType === "relation") {
    query = `[out:json];relation(${osmId});(._;>;);out geom;`;
  } else {
    query = `[out:json];(relation(${osmId});way(${osmId}););(._;>;);out geom;`;
  }
  const res = await fetch(OVERPASS, { method: "POST", body: "data=" + encodeURIComponent(query) });
  const data = await res.json();
  const ways = data.elements.filter(e => e.type === "way" && e.geometry && e.geometry.length > 2);
  if (!ways.length) return null;
  if (osmType === "relation" && ways.length > 1) {
    const relation = data.elements.find(e => e.type === "relation");
    let outerIds = new Set();
    if (relation?.members) relation.members.filter(m => m.type === "way" && m.role === "outer").forEach(m => outerIds.add(m.ref));
    const outerWays = outerIds.size > 0 ? ways.filter(w => outerIds.has(w.id)) : ways;
    const stitched = stitchWays(outerWays);
    if (stitched.length > 2) return [stitched];
  }
  const biggest = ways.sort((a, b) => b.geometry.length - a.geometry.length)[0];
  return [biggest.geometry.map(pt => [pt.lat, pt.lon])];
}

function stitchWays(ways) {
  if (!ways.length) return [];
  const segments = ways.map(w => w.geometry.map(pt => [pt.lat, pt.lon]));
  const result = [...segments[0]];
  const used = new Set([0]);
  while (used.size < segments.length) {
    const last = result[result.length - 1];
    let bestIdx = -1, bestReversed = false, bestDist = Infinity;
    for (let i = 0; i < segments.length; i++) {
      if (used.has(i)) continue;
      const seg = segments[i];
      const dS = dist(last, seg[0]);
      const dE = dist(last, seg[seg.length - 1]);
      if (dS < bestDist) { bestDist = dS; bestIdx = i; bestReversed = false; }
      if (dE < bestDist) { bestDist = dE; bestIdx = i; bestReversed = true; }
    }
    if (bestIdx === -1) break;
    used.add(bestIdx);
    const seg = bestReversed ? [...segments[bestIdx]].reverse() : segments[bestIdx];
    result.push(...seg.slice(1));
  }
  return result;
}
function dist([a, b], [c, d]) { return Math.sqrt((a-c)**2 + (b-d)**2); }

async function fetchCorpsLakes() {
  const all = [];
  for (const url of CORPS_URLS) {
    try {
      const res = await fetch(url);
      const text = await res.text();
      const lines = text.split("\n").filter(l => l.trim() && !l.startsWith("Location"));
      for (const line of lines) {
        const parts = line.split(",").map(p => p.trim());
        if (parts.length < 8) continue;
        const [name, elev, change24h, precip, inflow, outflow,, lat, lon] = parts;
        if (!lat || !lon || isNaN(parseFloat(lat))) continue;
        all.push({ name: name.trim(), elevation: parseFloat(elev), change24h: parseFloat(change24h), precip: parseFloat(precip), inflow: parseFloat(inflow), outflow: parseFloat(outflow), lat: parseFloat(lat), lon: parseFloat(lon) });
      }
    } catch (_) {}
  }
  return all;
}

async function fetchNearbyGauges(lat, lon, miles = 20) {
  const deg = miles / 69;
  const url = `${USGS}/iv/?format=json&bBox=${(lon-deg).toFixed(4)},${(lat-deg).toFixed(4)},${(lon+deg).toFixed(4)},${(lat+deg).toFixed(4)}&parameterCd=00060,00065&siteStatus=active&period=PT3H`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    const seen = new Set(); const stations = [];
    for (const ts of data.value.timeSeries) {
      const id = ts.sourceInfo.siteCode[0].value;
      const vals = ts.values[0].value.filter(v => v.value !== "-999999");
      const latest = vals.length ? parseFloat(vals[vals.length - 1].value) : null;
      const code = ts.variable.variableCode[0].value;
      const ex = stations.find(s => s.id === id);
      if (ex) { if (code === "00060") ex.flow = latest; if (code === "00065") ex.gauge = latest; }
      else if (!seen.has(id)) {
        seen.add(id);
        stations.push({ id, name: ts.sourceInfo.siteName, lat: parseFloat(ts.sourceInfo.geoLocation.geogLocation.latitude), lon: parseFloat(ts.sourceInfo.geoLocation.geogLocation.longitude), flow: code === "00060" ? latest : null, gauge: code === "00065" ? latest : null });
      }
    }
    return stations.filter(s => s.lat && s.lon);
  } catch (_) { return []; }
}

async function fetchGaugeHistory(siteId, period = "P7D") {
  const url = `${USGS}/iv/?format=json&sites=${siteId}&parameterCd=00060,00065&period=${period}`;
  const res = await fetch(url);
  const data = await res.json();
  const result = { flow: null, gauge: null, siteName: "" };
  for (const ts of data.value.timeSeries) {
    const code = ts.variable.variableCode[0].value;
    const unit = ts.variable.unit.unitCode;
    const values = ts.values[0].value.filter(v => v.value !== "-999999").map(v => ({ label: fmtTime(new Date(v.dateTime)), value: parseFloat(v.value) }));
    result.siteName = ts.sourceInfo.siteName;
    if (code === "00060") result.flow = { values, unit };
    if (code === "00065") result.gauge = { values, unit };
  }
  return result;
}

async function fetchWeather(lat, lon) {
  const url = `${WEATHER}?latitude=${lat}&longitude=${lon}&current=temperature_2m,wind_speed_10m,wind_gusts_10m,wind_direction_10m,precipitation,weather_code,relative_humidity_2m,surface_pressure,uv_index,apparent_temperature&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,uv_index_max,sunrise,sunset&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=auto&forecast_days=5`;
  const res = await fetch(url);
  return res.json();
}

// ── Moon phase ────────────────────────────────────────────────────────────────
function getMoonPhase() {
  const now = new Date();
  const knownNew = new Date("2024-01-11");
  const cycle = 29.53058867;
  const days = (now - knownNew) / 86400000;
  const phase = ((days % cycle) + cycle) % cycle;
  const pct = phase / cycle;
  let name, icon, fishing;
  if (pct < 0.03 || pct > 0.97) { name = "New Moon"; icon = "🌑"; fishing = "Excellent — fish are most active"; }
  else if (pct < 0.22) { name = "Waxing Crescent"; icon = "🌒"; fishing = "Good — increasing activity"; }
  else if (pct < 0.28) { name = "First Quarter"; icon = "🌓"; fishing = "Good — active feeding"; }
  else if (pct < 0.47) { name = "Waxing Gibbous"; icon = "🌔"; fishing = "Very Good — strong activity"; }
  else if (pct < 0.53) { name = "Full Moon"; icon = "🌕"; fishing = "Excellent — peak feeding"; }
  else if (pct < 0.72) { name = "Waning Gibbous"; icon = "🌖"; fishing = "Very Good — active"; }
  else if (pct < 0.78) { name = "Last Quarter"; icon = "🌗"; fishing = "Good"; }
  else { name = "Waning Crescent"; icon = "🌘"; fishing = "Fair — decreasing activity"; }
  return { name, icon, fishing, pct, phase: Math.round(phase) };
}

// ── Pressure trend ────────────────────────────────────────────────────────────
function pressureTrend(pressure) {
  if (!pressure) return { label: "Unknown", color: "#64748b", tip: "" };
  if (pressure > 1022) return { label: "High Pressure", color: "#22c55e", tip: "Fish shallow — good surface activity" };
  if (pressure > 1013) return { label: "Stable", color: "#38bdf8", tip: "Normal conditions" };
  if (pressure > 1005) return { label: "Low Pressure", color: "#f59e0b", tip: "Fish may go deeper" };
  return { label: "Very Low", color: "#ef4444", tip: "Fish are lethargic — tough bite" };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtTime(d) { return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString("en-US", { hour: "numeric", hour12: true }); }
function fmtClock(iso) { if (!iso) return "—"; return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }); }
function getTrend(values) {
  if (!values || values.length < 6) return null;
  const r = values.slice(-8).map(v => v.value);
  const pct = ((r[r.length-1] - r[0]) / (Math.abs(r[0]) || 1)) * 100;
  if (pct > 5)  return { dir: "Rising",  arrow: "↑", color: "#f59e0b" };
  if (pct < -5) return { dir: "Falling", arrow: "↓", color: "#38bdf8" };
  return              { dir: "Stable",  arrow: "→", color: "#22c55e" };
}
function weatherIcon(code) {
  if (!code && code !== 0) return "🌡️";
  if (code === 0) return "☀️"; if (code <= 3) return "⛅"; if (code <= 48) return "🌫️";
  if (code <= 67) return "🌧️"; if (code <= 77) return "❄️"; if (code <= 82) return "🌦️";
  return "⛈️";
}
function windDir(deg) { return ["N","NE","E","SE","S","SW","W","NW"][Math.round(deg/45)%8]; }
function levelColor(change) {
  if (!change && change !== 0) return { color: "#64748b", label: "Unknown" };
  if (change >  0.5) return { color: "#ef4444", label: "Rising Fast" };
  if (change >  0.1) return { color: "#f59e0b", label: "Rising" };
  if (change < -0.5) return { color: "#38bdf8", label: "Falling Fast" };
  if (change < -0.1) return { color: "#818cf8", label: "Falling" };
  return { color: "#22c55e", label: "Stable" };
}
function uvLabel(uv) {
  if (!uv && uv !== 0) return { label: "—", color: "#64748b" };
  if (uv <= 2) return { label: "Low", color: "#22c55e" };
  if (uv <= 5) return { label: "Moderate", color: "#f59e0b" };
  if (uv <= 7) return { label: "High", color: "#f97316" };
  if (uv <= 10) return { label: "Very High", color: "#ef4444" };
  return { label: "Extreme", color: "#a855f7" };
}

// ── Map Controller ────────────────────────────────────────────────────────────
function MapController({ center, zoom }) {
  const map = useMap();
  useEffect(() => { if (center) map.flyTo(center, zoom, { duration: 1.4 }); }, [center?.[0], center?.[1], zoom]);
  return null;
}

// ── Chart Tooltip ─────────────────────────────────────────────────────────────
function ChartTip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8, padding: "8px 12px", fontSize: 12 }}>
      <div style={{ color: "#475569", fontSize: 10, marginBottom: 3 }}>{label}</div>
      <div style={{ color: "#38bdf8", fontWeight: 700 }}>{payload[0].value?.toFixed(2)} <span style={{ color: "#475569", fontSize: 10 }}>{payload[0].name}</span></div>
    </div>
  );
}
function MiniChart({ data, unit, color, gradId }) {
  if (!data?.length) return <div style={{ color: "#475569", fontSize: 12, padding: 16, textAlign: "center" }}>No data</div>;
  const thinned = data.filter((_, i) => i % Math.max(1, Math.floor(data.length / 80)) === 0);
  return (
    <ResponsiveContainer width="100%" height={140}>
      <AreaChart data={thinned} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
        <defs><linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={color} stopOpacity={0.35}/><stop offset="95%" stopColor={color} stopOpacity={0}/></linearGradient></defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b"/>
        <XAxis dataKey="label" tick={{ fill: "#334155", fontSize: 8 }} interval="preserveStartEnd" tickLine={false}/>
        <YAxis tick={{ fill: "#475569", fontSize: 9 }} tickLine={false} axisLine={false} width={46}/>
        <RechartTooltip content={<ChartTip/>}/>
        <Area type="monotone" dataKey="value" stroke={color} strokeWidth={2} fill={`url(#${gradId})`} dot={false} name={unit}/>
      </AreaChart>
    </ResponsiveContainer>
  );
}

const PERIODS = [{ label: "24h", value: "P1D" }, { label: "7d", value: "P7D" }, { label: "30d", value: "P30D" }];
const DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

// ── LANDING PAGE ──────────────────────────────────────────────────────────────
function LandingPage({ onSearch }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const moon = getMoonPhase();

  const doSearch = async () => {
    if (!q.trim()) return;
    setSearching(true);
    try { const r = await geocodeLake(q); setResults(r.slice(0,6)); }
    catch (_) {} finally { setSearching(false); }
  };

  return (
    <div style={{ minHeight: "100vh", background: "#020817", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "40px 20px", fontFamily: "'Inter', system-ui, sans-serif" }}>

      {/* Logo + Title */}
      <div style={{ textAlign: "center", marginBottom: 48 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 14, marginBottom: 16 }}>
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
            <circle cx="24" cy="24" r="23" stroke="#1e293b" strokeWidth="1"/>
            <path d="M8 34 Q14 24 24 28 Q34 32 40 18" stroke="#38bdf8" strokeWidth="3" strokeLinecap="round" fill="none"/>
            <path d="M8 38 Q15 29 24 32 Q33 35 40 23" stroke="#0ea5e9" strokeWidth="1.5" strokeLinecap="round" fill="none" opacity="0.4"/>
            <circle cx="24" cy="28" r="3" fill="#38bdf8" opacity="0.6"/>
          </svg>
          <div>
            <div style={{ fontSize: 42, fontWeight: 900, color: "#f1f5f9", letterSpacing: "-0.04em", lineHeight: 1 }}>HydroWatch</div>
            <div style={{ fontSize: 14, color: "#475569", marginTop: 4, letterSpacing: "0.02em" }}>Live lake & river intelligence</div>
          </div>
        </div>
      </div>

      {/* Search box */}
      <div style={{ width: "100%", maxWidth: 560, position: "relative", marginBottom: 32 }}>
        <div style={{ display: "flex", gap: 10, background: "#0f172a", border: "1px solid #1e293b", borderRadius: 14, padding: "6px 6px 6px 18px", boxShadow: "0 0 0 1px #0f172a, 0 20px 60px rgba(0,0,0,0.5)" }}>
          <input
            value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === "Enter" && doSearch()}
            autoFocus
            placeholder="Search a lake, reservoir, or river…"
            style={{ flex: 1, background: "none", border: "none", fontSize: 16, color: "#e2e8f0", outline: "none", fontFamily: "inherit", padding: "8px 0" }}
          />
          <button onClick={doSearch} disabled={searching || !q.trim()} style={{
            background: "#0ea5e9", color: "#fff", border: "none", borderRadius: 10,
            padding: "10px 24px", fontSize: 14, fontWeight: 700, cursor: "pointer",
            opacity: searching || !q.trim() ? 0.5 : 1, fontFamily: "inherit", flexShrink: 0
          }}>{searching ? "Searching…" : "Search"}</button>
        </div>

        {/* Results dropdown */}
        {results.length > 0 && (
          <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, background: "#0f172a", border: "1px solid #1e293b", borderRadius: 12, overflow: "hidden", zIndex: 100, boxShadow: "0 8px 40px rgba(0,0,0,0.8)" }}>
            {results.map((r, i) => (
              <button key={i} onClick={() => onSearch(r)} style={{ width: "100%", textAlign: "left", background: "none", border: "none", padding: "12px 18px", cursor: "pointer", borderBottom: i < results.length-1 ? "1px solid #1e293b" : "none", fontFamily: "inherit" }}
                onMouseEnter={e => e.currentTarget.style.background = "#1e293b"}
                onMouseLeave={e => e.currentTarget.style.background = "none"}
              >
                <div style={{ fontSize: 14, color: "#e2e8f0", fontWeight: 600 }}>{r.display_name.split(",")[0]}</div>
                <div style={{ fontSize: 11, color: "#475569", marginTop: 2 }}>{r.display_name.split(",").slice(1,3).join(",").trim()}</div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Popular lakes */}
      <div style={{ width: "100%", maxWidth: 560, marginBottom: 48 }}>
        <div style={{ fontSize: 11, color: "#334155", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 12, textAlign: "center" }}>Popular Lakes</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
          {POPULAR_LAKES.map(l => (
            <button key={l.name} onClick={() => { setQ(l.name); geocodeLake(l.name).then(r => r.length && onSearch(r[0])); }} style={{
              background: "#0f172a", border: "1px solid #1e293b", borderRadius: 20,
              padding: "6px 16px", fontSize: 13, color: "#94a3b8", cursor: "pointer",
              fontFamily: "inherit", display: "flex", alignItems: "center", gap: 6
            }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "#38bdf8"; e.currentTarget.style.color = "#38bdf8"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "#1e293b"; e.currentTarget.style.color = "#94a3b8"; }}
            >
              {l.name} <span style={{ fontSize: 10, color: "#334155" }}>{l.state}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Moon + quick info strip */}
      <div style={{ display: "flex", gap: 16, width: "100%", maxWidth: 560, justifyContent: "center" }}>
        <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 12, padding: "14px 20px", display: "flex", alignItems: "center", gap: 12, flex: 1 }}>
          <div style={{ fontSize: 30 }}>{moon.icon}</div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#e2e8f0" }}>{moon.name}</div>
            <div style={{ fontSize: 11, color: "#475569", marginTop: 2 }}>Day {moon.phase} of cycle</div>
            <div style={{ fontSize: 10, color: "#22c55e", marginTop: 3 }}>{moon.fishing}</div>
          </div>
        </div>
        <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 12, padding: "14px 20px", flex: 1 }}>
          <div style={{ fontSize: 11, color: "#475569", marginBottom: 6 }}>Data Sources</div>
          {[["USGS NWIS","Live gauge data"],["Army Corps","Reservoir levels"],["Open-Meteo","Weather & UV"],["OpenStreetMap","Lake boundaries"]].map(([src, desc]) => (
            <div key={src} style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
              <span style={{ fontSize: 11, color: "#38bdf8", fontWeight: 600 }}>{src}</span>
              <span style={{ fontSize: 10, color: "#334155" }}>{desc}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 40, fontSize: 11, color: "#1e293b" }}>All data is public domain · No API key required</div>
    </div>
  );
}

// ── MAIN APP ──────────────────────────────────────────────────────────────────
export default function App() {
  const [view, setView]           = useState("landing"); // landing | map
  const [corpsLakes, setCorpsLakes] = useState([]);
  useEffect(() => { fetchCorpsLakes().then(setCorpsLakes); }, []);

  const [mapCenter, setMapCenter] = useState([30.35, -95.56]);
  const [mapZoom, setMapZoom]     = useState(11);
  const [placeName, setPlaceName] = useState("");
  const [lakeCenter, setLakeCenter] = useState(null);
  const [lakePolygon, setLakePolygon] = useState(null);
  const [lake, setLake]           = useState(null);
  const [weather, setWeather]     = useState(null);
  const [gauges, setGauges]       = useState([]);
  const [loading, setLoading]     = useState(false);
  const [loadMsg, setLoadMsg]     = useState("");

  const [selectedGauge, setSelectedGauge] = useState(null);
  const [gaugeHistory, setGaugeHistory]   = useState(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [period, setPeriod]       = useState("P7D");
  const [hovered, setHovered]     = useState(null);
  const [activeTab, setActiveTab] = useState("overview");
  const [query, setQuery]         = useState("");
  const [geoResults, setGeoResults] = useState([]);
  const [searching, setSearching] = useState(false);

  const moon = getMoonPhase();

  const loadPlace = async (place) => {
    const lat = parseFloat(place.lat);
    const lon = parseFloat(place.lon);
    const name = place.display_name.split(",")[0];
    setView("map");
    setGeoResults([]);
    setQuery("");
    setPlaceName(name);
    setLakeCenter([lat, lon]);
    setMapCenter([lat, lon]);
    setMapZoom(12);
    setActiveTab("overview");
    setLake(null); setLakePolygon(null); setGauges([]);
    setSelectedGauge(null); setGaugeHistory(null);
    setLoading(true);

    const nameLower = name.toLowerCase();
    const match = corpsLakes.find(l => {
      const cn = l.name.toLowerCase();
      return cn.includes(nameLower.replace(" lake","").replace(" reservoir","").trim()) ||
             nameLower.includes(cn.replace(" lake","").replace(" reservoir","").trim());
    });
    if (match) setLake(match);

    setLoadMsg("Fetching lake boundary…");
    const [poly, nearbyGauges, wx] = await Promise.all([
      fetchLakePolygon(place.osm_id, place.osm_type).catch(() => null),
      fetchNearbyGauges(lat, lon, 20),
      fetchWeather(lat, lon).catch(() => null),
    ]);
    setLakePolygon(poly);
    setGauges(nearbyGauges);
    setWeather(wx);
    setLoading(false);
    setLoadMsg("");
  };

  const handleSearchMap = async () => {
    if (!query.trim()) return;
    setSearching(true); setGeoResults([]);
    try { const r = await geocodeLake(query); setGeoResults(r.slice(0,6)); }
    catch (_) {} finally { setSearching(false); }
  };

  const handleSelectGauge = async (g) => {
    setSelectedGauge(g); setGaugeHistory(null);
    setActiveTab("gauge-detail"); setLoadingHistory(true);
    try { const h = await fetchGaugeHistory(g.id, period); setGaugeHistory(h); }
    catch (_) {} setLoadingHistory(false);
  };
  useEffect(() => { if (selectedGauge) handleSelectGauge(selectedGauge); }, [period]);

  const lvlStatus  = lake ? levelColor(lake.change24h) : null;
  const polyColor  = lvlStatus?.color || "#38bdf8";
  const flowTrend  = getTrend(gaugeHistory?.flow?.values);
  const gaugeTrend = getTrend(gaugeHistory?.gauge?.values);
  const pressure   = weather?.current?.surface_pressure;
  const pressTrend = pressureTrend(pressure);
  const uvInfo     = uvLabel(weather?.current?.uv_index);

  if (view === "landing") return <LandingPage onSearch={loadPlace}/>;

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "#020817", fontFamily: "'Inter', system-ui, sans-serif", color: "#e2e8f0" }}>

      {/* ── HEADER ── */}
      <div style={{ height: 54, borderBottom: "1px solid #1e293b", display: "flex", alignItems: "center", padding: "0 16px", gap: 12, flexShrink: 0, background: "#020817", zIndex: 2000 }}>
        <button onClick={() => setView("landing")} style={{ background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 8, padding: "4px 8px 4px 0" }}>
          <svg width="20" height="20" viewBox="0 0 28 28" fill="none">
            <path d="M4 20 Q7 14 14 16 Q21 18 24 10" stroke="#38bdf8" strokeWidth="2.5" strokeLinecap="round" fill="none"/>
            <path d="M4 22 Q8 17 14 19 Q20 21 24 14" stroke="#0ea5e9" strokeWidth="1.5" strokeLinecap="round" fill="none" opacity="0.5"/>
          </svg>
          <span style={{ fontWeight: 800, fontSize: 15, color: "#f1f5f9", letterSpacing: "-0.02em" }}>HydroWatch</span>
        </button>
        <div style={{ width: 1, height: 18, background: "#1e293b" }}/>

        {/* In-map search */}
        <div style={{ position: "relative", flex: 1, maxWidth: 440 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSearchMap()}
              placeholder="Search another lake…"
              style={{ flex: 1, background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8, padding: "6px 14px", fontSize: 13, color: "#e2e8f0", outline: "none", fontFamily: "inherit" }}
            />
            <button onClick={handleSearchMap} disabled={searching || !query.trim()} style={{ background: "#0ea5e9", color: "#fff", border: "none", borderRadius: 8, padding: "6px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer", opacity: searching || !query.trim() ? 0.5 : 1, fontFamily: "inherit" }}>
              {searching ? "…" : "Go"}
            </button>
          </div>
          {geoResults.length > 0 && (
            <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, background: "#0f172a", border: "1px solid #1e293b", borderRadius: 10, overflow: "hidden", zIndex: 9999, boxShadow: "0 8px 32px rgba(0,0,0,0.8)" }}>
              {geoResults.map((r, i) => (
                <button key={i} onClick={() => loadPlace(r)} style={{ width: "100%", textAlign: "left", background: "none", border: "none", padding: "10px 14px", cursor: "pointer", borderBottom: "1px solid #1e293b", fontFamily: "inherit" }}
                  onMouseEnter={e => e.currentTarget.style.background = "#1e293b"}
                  onMouseLeave={e => e.currentTarget.style.background = "none"}
                >
                  <div style={{ fontSize: 13, color: "#e2e8f0", fontWeight: 500 }}>{r.display_name.split(",")[0]}</div>
                  <div style={{ fontSize: 10, color: "#475569", marginTop: 2 }}>{r.display_name.split(",").slice(1,3).join(",").trim()}</div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div style={{ fontSize: 13, fontWeight: 700, color: "#38bdf8", marginLeft: 4 }}>{placeName}</div>
        {loading && <div style={{ fontSize: 12, color: "#64748b" }}>⟳ {loadMsg}</div>}
        <div style={{ marginLeft: "auto", fontSize: 10, color: "#1e293b" }}>USGS · USACE · Open-Meteo · OSM</div>
      </div>

      {/* ── BODY ── */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

        {/* ── MAP ── */}
        <div style={{ flex: 1, position: "relative" }}>
          <MapContainer center={mapCenter} zoom={mapZoom} style={{ height: "100%", width: "100%" }} zoomControl={false}>
            <ZoomControl position="bottomright"/>
            <MapController center={mapCenter} zoom={mapZoom}/>
            <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" attribution="Esri" maxZoom={19}/>
            <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png" opacity={0.6}/>
            {lakePolygon && lakePolygon.map((ring, i) => (
              <Polygon key={i} positions={ring} pathOptions={{ color: polyColor, fillColor: polyColor, fillOpacity: 0.2, weight: 2.5, opacity: 0.9 }}/>
            ))}
            {gauges.map(g => {
              const isSel = selectedGauge?.id === g.id;
              const isHov = hovered === g.id;
              const c = isSel ? "#f59e0b" : "#38bdf8";
              return (
                <CircleMarker key={g.id} center={[g.lat, g.lon]} radius={isSel ? 14 : isHov ? 11 : 8}
                  pathOptions={{ color: "#fff", fillColor: c, fillOpacity: isSel ? 1 : 0.85, weight: isSel ? 3 : 1.5 }}
                  eventHandlers={{ click: () => handleSelectGauge(g), mouseover: () => setHovered(g.id), mouseout: () => setHovered(null) }}
                >
                  <Tooltip direction="top" offset={[0,-10]} opacity={1}>
                    <div style={{ background: "#0f172a", border: `1.5px solid ${c}`, borderRadius: 10, padding: "10px 14px", minWidth: 190, fontFamily: "inherit", boxShadow: "0 4px 24px rgba(0,0,0,0.9)" }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#f1f5f9", marginBottom: 8 }}>{g.name}</div>
                      <div style={{ display: "flex", gap: 16 }}>
                        {g.flow  != null && <div><div style={{ fontSize: 9, color: "#475569", marginBottom: 2 }}>FLOW</div><div style={{ fontSize: 14, fontWeight: 700, color: "#38bdf8" }}>{g.flow.toLocaleString()} <span style={{ fontSize: 9, color: "#475569" }}>ft³/s</span></div></div>}
                        {g.gauge != null && <div><div style={{ fontSize: 9, color: "#475569", marginBottom: 2 }}>STAGE</div><div style={{ fontSize: 14, fontWeight: 700, color: "#818cf8" }}>{g.gauge.toFixed(2)} <span style={{ fontSize: 9, color: "#475569" }}>ft</span></div></div>}
                      </div>
                      <div style={{ marginTop: 8, fontSize: 9, color: "#334155" }}>Click to view charts →</div>
                    </div>
                  </Tooltip>
                </CircleMarker>
              );
            })}
          </MapContainer>

          {/* Map legend */}
          <div style={{ position: "absolute", bottom: 48, left: 16, zIndex: 1000, background: "rgba(2,8,23,0.92)", border: "1px solid #1e293b", borderRadius: 10, padding: "12px 14px", backdropFilter: "blur(8px)" }}>
            <div style={{ fontSize: 9, color: "#475569", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>Map Layers</div>
            {lakePolygon && <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}><div style={{ width: 24, height: 3, background: polyColor, borderRadius: 2 }}/><span style={{ fontSize: 11, color: "#94a3b8" }}>Lake boundary</span></div>}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}><div style={{ width: 10, height: 10, borderRadius: "50%", background: "#38bdf8" }}/><span style={{ fontSize: 11, color: "#94a3b8" }}>USGS gauge</span></div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}><div style={{ width: 10, height: 10, borderRadius: "50%", background: "#f59e0b" }}/><span style={{ fontSize: 11, color: "#94a3b8" }}>Selected</span></div>
          </div>
        </div>

        {/* ── RIGHT PANEL ── */}
        <div style={{ width: 400, background: "#020817", borderLeft: "1px solid #1e293b", overflowY: "auto", flexShrink: 0, display: "flex", flexDirection: "column" }}>

          {/* Panel header + tabs */}
          <div style={{ padding: "16px 20px 0", borderBottom: "1px solid #1e293b", flexShrink: 0 }}>
            <div style={{ fontSize: 10, color: "#475569", marginBottom: 3 }}>{lake ? "Army Corps Reservoir" : "USGS Monitoring Station"}</div>
            <div style={{ fontSize: 17, fontWeight: 800, color: "#f1f5f9", marginBottom: 12, lineHeight: 1.2 }}>{lake?.name || placeName}</div>
            <div style={{ display: "flex", gap: 0 }}>
              {[["overview","Overview"],["gauges",`Gauges (${gauges.length})`],].map(([tab, label]) => (
                <button key={tab} onClick={() => setActiveTab(tab)} style={{
                  background: "none", border: "none", padding: "8px 16px", fontSize: 12, fontWeight: 600,
                  cursor: "pointer", fontFamily: "inherit",
                  color: (activeTab === tab || (tab === "gauges" && activeTab === "gauge-detail")) ? "#38bdf8" : "#475569",
                  borderBottom: `2px solid ${(activeTab === tab || (tab === "gauges" && activeTab === "gauge-detail")) ? "#38bdf8" : "transparent"}`,
                  marginBottom: -1,
                }}>{label}</button>
              ))}
            </div>
          </div>

          <div style={{ padding: "16px 20px", flex: 1, overflowY: "auto" }}>

            {/* ── OVERVIEW ── */}
            {activeTab === "overview" && (
              <div>
                {/* Army Corps */}
                {lake && (
                  <div style={{ marginBottom: 20 }}>
                    <div style={{ fontSize: 10, color: "#475569", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 10 }}>Reservoir Levels</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                      <div style={{ width: 8, height: 8, borderRadius: "50%", background: lvlStatus.color }}/>
                      <span style={{ fontSize: 13, color: lvlStatus.color, fontWeight: 700 }}>{lvlStatus.label}</span>
                      <span style={{ fontSize: 11, color: "#475569" }}>{lake.change24h >= 0 ? "+" : ""}{lake.change24h?.toFixed(2)} ft in 24h</span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 4 }}>
                      {[
                        { label: "Pool Elevation", value: lake.elevation?.toFixed(2), unit: "ft", color: "#38bdf8" },
                        { label: "24h Change",     value: (lake.change24h >= 0 ? "+" : "") + lake.change24h?.toFixed(2), unit: "ft", color: lvlStatus.color },
                        { label: "Inflow",         value: lake.inflow?.toLocaleString(), unit: "cfs", color: "#22c55e" },
                        { label: "Outflow",        value: lake.outflow?.toLocaleString(), unit: "cfs", color: "#818cf8" },
                      ].map(({ label, value, unit, color }) => (
                        <div key={label} style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 10, padding: "12px 14px" }}>
                          <div style={{ fontSize: 9, color: "#475569", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>{label}</div>
                          <div style={{ fontSize: 20, fontWeight: 800, color, lineHeight: 1 }}>{value ?? "—"}<span style={{ fontSize: 10, color: "#475569", fontWeight: 400, marginLeft: 4 }}>{unit}</span></div>
                        </div>
                      ))}
                    </div>
                    <div style={{ borderBottom: "1px solid #1e293b", margin: "16px 0" }}/>
                  </div>
                )}

                {/* Weather */}
                {weather?.current && (
                  <div style={{ marginBottom: 20 }}>
                    <div style={{ fontSize: 10, color: "#475569", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 10 }}>Current Conditions</div>

                    {/* Main weather card */}
                    <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 12, padding: "16px", marginBottom: 10 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
                        <div style={{ fontSize: 48 }}>{weatherIcon(weather.current.weather_code)}</div>
                        <div>
                          <div style={{ fontSize: 38, fontWeight: 900, color: "#f1f5f9", lineHeight: 1 }}>{Math.round(weather.current.temperature_2m)}°F</div>
                          <div style={{ fontSize: 12, color: "#475569", marginTop: 3 }}>Feels like {Math.round(weather.current.apparent_temperature)}°F</div>
                        </div>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                        {[
                          { label: "Wind", value: `${Math.round(weather.current.wind_speed_10m)} mph`, sub: windDir(weather.current.wind_direction_10m), color: "#e2e8f0" },
                          { label: "Gusts", value: `${Math.round(weather.current.wind_gusts_10m)} mph`, sub: "max gust", color: "#e2e8f0" },
                          { label: "Humidity", value: `${weather.current.relative_humidity_2m}%`, sub: "RH", color: "#e2e8f0" },
                        ].map(({ label, value, sub, color }) => (
                          <div key={label} style={{ background: "#020817", borderRadius: 8, padding: "10px 12px" }}>
                            <div style={{ fontSize: 9, color: "#475569", marginBottom: 4, textTransform: "uppercase" }}>{label}</div>
                            <div style={{ fontSize: 14, fontWeight: 700, color }}>{value}</div>
                            <div style={{ fontSize: 9, color: "#334155" }}>{sub}</div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Pressure + UV row */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
                      <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 10, padding: "12px 14px" }}>
                        <div style={{ fontSize: 9, color: "#475569", textTransform: "uppercase", marginBottom: 6 }}>Barometric Pressure</div>
                        <div style={{ fontSize: 18, fontWeight: 800, color: pressTrend.color, lineHeight: 1 }}>{pressure?.toFixed(0)} <span style={{ fontSize: 10, color: "#475569", fontWeight: 400 }}>hPa</span></div>
                        <div style={{ fontSize: 11, color: pressTrend.color, marginTop: 5, fontWeight: 600 }}>{pressTrend.label}</div>
                        <div style={{ fontSize: 10, color: "#475569", marginTop: 2 }}>{pressTrend.tip}</div>
                      </div>
                      <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 10, padding: "12px 14px" }}>
                        <div style={{ fontSize: 9, color: "#475569", textTransform: "uppercase", marginBottom: 6 }}>UV Index</div>
                        <div style={{ fontSize: 18, fontWeight: 800, color: uvInfo.color, lineHeight: 1 }}>{weather.current.uv_index ?? "—"}</div>
                        <div style={{ fontSize: 11, color: uvInfo.color, marginTop: 5, fontWeight: 600 }}>{uvInfo.label}</div>
                        <div style={{ fontSize: 10, color: "#475569", marginTop: 2 }}>Precipitation: {weather.current.precipitation}"</div>
                      </div>
                    </div>

                    {/* Sunrise / Sunset */}
                    {weather.daily?.sunrise?.[0] && (
                      <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 10, padding: "12px 16px", marginBottom: 10 }}>
                        <div style={{ display: "flex", justifyContent: "space-around" }}>
                          <div style={{ textAlign: "center" }}>
                            <div style={{ fontSize: 20, marginBottom: 4 }}>🌅</div>
                            <div style={{ fontSize: 9, color: "#475569", marginBottom: 2 }}>SUNRISE</div>
                            <div style={{ fontSize: 14, fontWeight: 700, color: "#fbbf24" }}>{fmtClock(weather.daily.sunrise[0])}</div>
                          </div>
                          <div style={{ width: 1, background: "#1e293b" }}/>
                          <div style={{ textAlign: "center" }}>
                            <div style={{ fontSize: 20, marginBottom: 4 }}>🌇</div>
                            <div style={{ fontSize: 9, color: "#475569", marginBottom: 2 }}>SUNSET</div>
                            <div style={{ fontSize: 14, fontWeight: 700, color: "#f97316" }}>{fmtClock(weather.daily.sunset[0])}</div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Moon phase */}
                    <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 10, padding: "12px 16px", marginBottom: 10, display: "flex", alignItems: "center", gap: 14 }}>
                      <div style={{ fontSize: 32 }}>{moon.icon}</div>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: "#e2e8f0" }}>{moon.name} — Day {moon.phase}</div>
                        <div style={{ fontSize: 11, color: "#22c55e", marginTop: 3, fontWeight: 600 }}>Fishing: {moon.fishing}</div>
                      </div>
                    </div>

                    {/* 5-day forecast */}
                    {weather.daily?.time && (
                      <div>
                        <div style={{ fontSize: 10, color: "#475569", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>5-Day Forecast</div>
                        <div style={{ display: "flex", gap: 6 }}>
                          {weather.daily.time.slice(0,5).map((date, i) => {
                            const d = new Date(date + "T12:00:00");
                            return (
                              <div key={i} style={{ flex: 1, background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8, padding: "10px 6px", textAlign: "center" }}>
                                <div style={{ fontSize: 9, color: "#475569", marginBottom: 4 }}>{i === 0 ? "Today" : DAYS[d.getDay()]}</div>
                                <div style={{ fontSize: 18, marginBottom: 6 }}>{weatherIcon(0)}</div>
                                <div style={{ fontSize: 12, fontWeight: 700, color: "#f1f5f9" }}>{Math.round(weather.daily.temperature_2m_max[i])}°</div>
                                <div style={{ fontSize: 10, color: "#475569" }}>{Math.round(weather.daily.temperature_2m_min[i])}°</div>
                                {weather.daily.precipitation_sum[i] > 0.01 && (
                                  <div style={{ fontSize: 9, color: "#38bdf8", marginTop: 3 }}>{weather.daily.precipitation_sum[i].toFixed(2)}"</div>
                                )}
                                <div style={{ fontSize: 9, color: uvLabel(weather.daily.uv_index_max[i]).color, marginTop: 2 }}>UV {weather.daily.uv_index_max[i]}</div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ── GAUGES TAB ── */}
            {activeTab === "gauges" && (
              <div>
                {gauges.length === 0 && <div style={{ textAlign: "center", padding: "30px 0", color: "#475569", fontSize: 13 }}>No USGS gauges found within 20 miles.</div>}
                {gauges.map(g => (
                  <button key={g.id} onClick={() => handleSelectGauge(g)} style={{
                    width: "100%", textAlign: "left",
                    background: selectedGauge?.id === g.id ? "#0c1a2e" : "#0f172a",
                    border: `1px solid ${selectedGauge?.id === g.id ? "#38bdf8" : "#1e293b"}`,
                    borderRadius: 10, padding: "12px 14px", marginBottom: 8, cursor: "pointer", fontFamily: "inherit"
                  }}
                    onMouseEnter={e => { if (selectedGauge?.id !== g.id) e.currentTarget.style.borderColor = "#334155"; }}
                    onMouseLeave={e => { if (selectedGauge?.id !== g.id) e.currentTarget.style.borderColor = "#1e293b"; }}
                  >
                    <div style={{ fontSize: 12, color: "#e2e8f0", fontWeight: 600, marginBottom: 6 }}>{g.name}</div>
                    <div style={{ display: "flex", gap: 14, fontSize: 11 }}>
                      {g.flow  != null && <span style={{ color: "#38bdf8" }}>Flow: <strong>{g.flow.toLocaleString()}</strong> ft³/s</span>}
                      {g.gauge != null && <span style={{ color: "#818cf8" }}>Stage: <strong>{g.gauge.toFixed(2)}</strong> ft</span>}
                    </div>
                    <div style={{ fontSize: 10, color: "#334155", marginTop: 4 }}>#{g.id} · Click for charts →</div>
                  </button>
                ))}
              </div>
            )}

            {/* ── GAUGE DETAIL ── */}
            {activeTab === "gauge-detail" && selectedGauge && (
              <div>
                <button onClick={() => setActiveTab("gauges")} style={{ background: "none", border: "none", color: "#38bdf8", fontSize: 12, cursor: "pointer", fontFamily: "inherit", padding: "0 0 12px", display: "flex", alignItems: "center", gap: 4 }}>← All Gauges</button>
                <div style={{ fontSize: 9, color: "#475569", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>USGS #{selectedGauge.id}</div>
                <div style={{ fontSize: 15, fontWeight: 800, color: "#f1f5f9", marginBottom: 14, lineHeight: 1.25 }}>{gaugeHistory?.siteName || selectedGauge.name}</div>
                <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                  <div style={{ flex: 1, background: "#0f172a", border: "1px solid #1e293b", borderRadius: 10, padding: "12px 14px" }}>
                    <div style={{ fontSize: 9, color: "#475569", textTransform: "uppercase", marginBottom: 6 }}>Flow</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: "#38bdf8", lineHeight: 1 }}>{selectedGauge.flow?.toLocaleString() ?? "—"}<span style={{ fontSize: 10, color: "#475569", fontWeight: 400, marginLeft: 4 }}>ft³/s</span></div>
                    {flowTrend && <div style={{ fontSize: 11, color: flowTrend.color, marginTop: 6, fontWeight: 600 }}>{flowTrend.arrow} {flowTrend.dir}</div>}
                  </div>
                  <div style={{ flex: 1, background: "#0f172a", border: "1px solid #1e293b", borderRadius: 10, padding: "12px 14px" }}>
                    <div style={{ fontSize: 9, color: "#475569", textTransform: "uppercase", marginBottom: 6 }}>Stage</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: "#818cf8", lineHeight: 1 }}>{selectedGauge.gauge?.toFixed(2) ?? "—"}<span style={{ fontSize: 10, color: "#475569", fontWeight: 400, marginLeft: 4 }}>ft</span></div>
                    {gaugeTrend && <div style={{ fontSize: 11, color: gaugeTrend.color, marginTop: 6, fontWeight: 600 }}>{gaugeTrend.arrow} {gaugeTrend.dir}</div>}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
                  {PERIODS.map(p => (
                    <button key={p.value} onClick={() => setPeriod(p.value)} style={{ background: period === p.value ? "#0ea5e9" : "#0f172a", color: period === p.value ? "#fff" : "#64748b", border: "1px solid " + (period === p.value ? "#0ea5e9" : "#1e293b"), borderRadius: 6, padding: "4px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>{p.label}</button>
                  ))}
                </div>
                {loadingHistory && <div style={{ textAlign: "center", padding: "24px 0", color: "#475569", fontSize: 13 }}>Loading…</div>}
                {gaugeHistory && !loadingHistory && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {gaugeHistory.flow && (
                      <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 10, padding: "12px 12px 8px" }}>
                        <div style={{ fontSize: 9, color: "#475569", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>Stream Flow ({gaugeHistory.flow.unit})</div>
                        <MiniChart data={gaugeHistory.flow.values} unit={gaugeHistory.flow.unit} color="#38bdf8" gradId="fg"/>
                      </div>
                    )}
                    {gaugeHistory.gauge && (
                      <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 10, padding: "12px 12px 8px" }}>
                        <div style={{ fontSize: 9, color: "#475569", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>Stage Height ({gaugeHistory.gauge.unit})</div>
                        <MiniChart data={gaugeHistory.gauge.values} unit={gaugeHistory.gauge.unit} color="#818cf8" gradId="gg"/>
                      </div>
                    )}
                    <div style={{ fontSize: 10, color: "#334155", textAlign: "center", paddingBottom: 4 }}>Updated {new Date().toLocaleTimeString()} · USGS NWIS</div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <style>{`
        .leaflet-tooltip { background: transparent !important; border: none !important; box-shadow: none !important; padding: 0 !important; }
        .leaflet-tooltip-top::before { display: none !important; }
        .leaflet-container { background: #020817; }
        * { box-sizing: border-box; }
      `}</style>
    </div>
  );
}