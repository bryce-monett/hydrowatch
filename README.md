# 🌊 HydroWatch

**Live lake and river intelligence dashboard — built entirely on free, public APIs.**

Search any lake, reservoir, or river in the US and get a real-time satellite map with the full lake boundary, water level data, stream flow gauges, weather conditions, moon phase, barometric pressure trends, UV index, sunrise/sunset, and a 5-day forecast — all in one place.

---

## Live Demo

Search any lake to get started:
- **Lake Travis** — Army Corps reservoir with pool elevation + inflow/outflow data
- **Lake Conroe** — Full OSM boundary + USGS gauge charts
- **Canyon Lake** — Army Corps + weather + moon phase
- **Lake Tahoe** — USGS monitoring + full satellite view
- **Grapevine Lake** — Army Corps + 5-day forecast

---

## Features

### 🗺️ Interactive Satellite Map
- Full lake boundary polygon pulled from OpenStreetMap and stitched from all boundary segments
- Satellite imagery from Esri World Imagery
- USGS gauge markers plotted on the lake — hover for live readings, click for charts
- Boundary color reflects current water level status (rising/falling/stable/flood)

### 💧 Water Level Data (Army Corps of Engineers)
- Pool elevation in feet
- 24-hour water level change
- Inflow and outflow in cfs
- Covers ~700 major US reservoirs — no API key required

### 📊 USGS Stream Gauges
- All active gauges within 20 miles of the searched lake
- Live stream flow (ft³/s) and stage height (ft)
- 24h / 7d / 30d historical charts with area graphs
- Rising/falling/stable trend detection

### 🌤️ Weather & Conditions
- Current temperature, feels-like, humidity
- Wind speed and gusts with compass direction
- Barometric pressure with fishing-specific interpretation
- UV index with severity rating
- Precipitation
- Sunrise and sunset times for the lake location
- 5-day forecast with daily high/low, precip totals, and UV max

### 🌕 Moon Phase
- Calculated locally — no API needed
- Current phase name and icon
- Day in 29.5-day lunar cycle
- Fishing activity rating based on phase

---

## Getting Started

```bash
git clone https://github.com/bryce-monett/hydrowatch.git
cd hydrowatch
npm install --legacy-peer-deps
npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

### Build for production

```bash
npm run build
npm run preview
```

---

## Data Sources

All data is **free, public domain, and requires no API key.**

| Source | Data Provided | Endpoint |
|---|---|---|
| **USGS NWIS** | Stream flow, stage height, gauge history | `waterservices.usgs.gov/nwis` |
| **Army Corps of Engineers** | Pool elevation, inflow, outflow, 24h change | `water.usace.army.mil` |
| **Open-Meteo** | Weather, forecasts, UV, pressure, sunrise/sunset | `api.open-meteo.com` |
| **OpenStreetMap Overpass** | Lake boundary polygons | `overpass-api.de` |
| **Nominatim** | Lake/river geocoding | `nominatim.openstreetmap.org` |

### USGS Parameter Codes

| Code | Description | Unit |
|---|---|---|
| `00060` | Discharge / Stream Flow | ft³/s |
| `00065` | Gauge Height / Stage | ft |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | React 18 |
| Build | Vite |
| Map | Leaflet + React-Leaflet |
| Charts | Recharts |
| Styling | Inline CSS (zero dependencies) |
| Data | 5 free public APIs |

---

## Project Structure

```
hydrowatch/
├── index.html
├── package.json
├── vite.config.js
└── src/
    ├── main.jsx        # React entry point
    └── App.jsx         # Full app — landing page, map, data panel
```

### Key Functions in App.jsx

| Function | Purpose |
|---|---|
| `fetchLakePolygon()` | Fetches OSM relation/way geometry and stitches multi-segment boundaries |
| `stitchWays()` | Connects disconnected way segments into a continuous polygon ring |
| `fetchCorpsLakes()` | Loads Army Corps reservoir summary CSV for all TX/SW districts |
| `fetchNearbyGauges()` | Bounding-box query for active USGS gauges within N miles |
| `fetchGaugeHistory()` | Instantaneous values time series for a specific site |
| `fetchWeather()` | Open-Meteo current + forecast + UV + pressure |
| `getMoonPhase()` | Calculates lunar phase locally from known new moon epoch |
| `pressureTrend()` | Classifies barometric pressure with fishing-relevant interpretation |

---

## Why This Stack

The USGS NWIS and Army Corps APIs are the same data sources used by commercial fishing and outdoor apps. Understanding their data pipeline — bounding box gauge queries, reservoir CSV endpoints, OSM polygon stitching — is directly relevant to building hydrology-aware mobile and web applications.

Open-Meteo provides ECMWF-quality weather data with no rate limits or authentication, making it ideal for client-side apps that can't expose API keys.

---

## Roadmap

- [ ] Water temperature overlay (`00010` USGS parameter)
- [ ] NWS flood stage alerts per gauge
- [ ] Compare two lakes side by side
- [ ] Solunar fishing tables (peak bite time windows)
- [ ] Exportable CSV data downloads
- [ ] PWA support for offline lake data

---

## License

MIT

---

*Built by Bryce Monnet · All data public domain · No API keys required*
