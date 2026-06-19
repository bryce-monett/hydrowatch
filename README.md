# 🌊 HydroWatch

**Live river and lake monitoring dashboard powered by the USGS National Water Information System.**

Search any of 10,000+ active stream gauges across the US and get real-time stream flow, gauge height, and trend analysis — no API key required.

---

## Features

- **Search 10,000+ USGS stations** by river/lake name or state code
- **Live stream flow** (ft³/s) and **gauge height** (ft) from USGS NWIS
- **Interactive time-series charts** with 24h / 7d / 30d windows
- **Flood risk classification** based on historical gauge percentile
- **Trend detection** — rising, falling, or stable at a glance
- **Zero backend** — all data fetched client-side from public USGS APIs
- **No API key** required

---

## Demo

> Select a popular station or search by name to load live data.

**Popular stations included out of the box:**
- Colorado River at Austin, TX
- Mississippi River at Baton Rouge, LA
- Willamette River at Portland, OR
- Colorado River at Lees Ferry, AZ
- Potomac River near Washington, DC

---

## Getting Started

```bash
git clone https://github.com/YOUR_USERNAME/hydrowatch.git
cd hydrowatch
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

### Build for production

```bash
npm run build
npm run preview
```

---

## Data Source

All hydrological data is sourced from the **[USGS National Water Information System (NWIS)](https://waterservices.usgs.gov/)** — a free, public API maintained by the US Geological Survey.

| Endpoint | Purpose |
|---|---|
| `waterservices.usgs.gov/nwis/iv/` | Instantaneous values (flow, gauge height) |
| `waterservices.usgs.gov/nwis/site/` | Station search and metadata |

**Parameter codes used:**

| Code | Description | Unit |
|---|---|---|
| `00060` | Discharge / Stream Flow | ft³/s |
| `00065` | Gauge Height | ft |

No authentication required. Data is in the public domain.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | React 18 |
| Build | Vite |
| Charts | Recharts |
| Data | USGS NWIS REST API |
| Styling | Inline CSS (zero dependencies) |

---

## Project Structure

```
hydrowatch/
├── index.html
├── package.json
├── vite.config.js
└── src/
    ├── main.jsx        # React entry point
    └── App.jsx         # Full app — search, fetch, dashboard, charts
```

---

## Why USGS NWIS?

The USGS operates over **10,000 real-time stream gauges** across the US, reporting data every 15 minutes. This data powers federal flood forecasting, water resource management, and — increasingly — consumer outdoor apps.

Understanding this data pipeline is directly relevant to applications in:
- Flood monitoring and early warning systems
- Fishing condition forecasting (water clarity, flow, temperature)
- Agricultural water management
- Recreational river and lake planning

---

## Roadmap

- [ ] Map view of nearby stations using Leaflet
- [ ] NOAA flood stage integration per station
- [ ] Water temperature overlay (`00010`)
- [ ] Exportable CSV / JSON data downloads
- [ ] Alert thresholds with browser notifications
- [ ] Compare multiple stations side-by-side

---

## License

MIT — use it however you want.

---

*Built by Bryce Monnet · Data provided by USGS NWIS (public domain)*
