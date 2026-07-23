# Gajashakthi Wialon GPS Demo - Developer Guide

Welcome to the Gajashakthi Wialon GPS Demo! This document serves as a crash course for new developers joining the project. It explains how our frontend interacts with the Wialon Telematics API, the quirks of the Wialon data structures, and how our map rendering works.

---

## 1. Architecture Overview
This is a lightweight, Vanilla JavaScript application that heavily relies on the Wialon REST API. 
* **`index.html` & `style.css`**: The UI skeleton and styling.
* **`app.js`**: The core application logic, split into classes (`WialonAPI`, `MapController`, `TravelModule`, `App`).
* **`dev-server.js`**: A simple Node.js proxy server. Because Wialon's API (`hst-api.wialon.com`) strictly blocks direct cross-origin (CORS) browser requests, all API calls from `app.js` are sent to `http://localhost:3000/api/wialon`, which then securely proxies them to the Wialon servers.

---

## 2. Wialon API Integration (`WialonAPI` class)

Wialon's API is incredibly powerful but often undocumented and archaic. It operates on a session-based architecture.

### Authentication (`token/login`)
Before making any requests, the app authenticates using a static Token. The server returns an `eid` (Session ID). Every subsequent request must include this `sid=${eid}` in the URL or payload. 

### Fetching Live Units (`core/search_items`)
To populate the dashboard dropdown and the map, we search for items of type `avl_unit`.
* **The Flag System:** Wialon doesn't return all data by default. You must request specific "flags" (bitwise integers). We use `flags: 4611425` to request the base info, custom properties, sensors, and the **Last Message (`lmsg`)** which contains the vehicle's live GPS coordinates.
* **Ignition Detection:** To know if the engine is ON or OFF, we read the tracker's parameters. Some trackers send `in1`, others send `acc`. We check `unit.lmsg.p` (last ping), but if the vehicle is parked and sending "heartbeats" without parameters, we fall back to `unit.prms` (Wialon's persistent memory of the last known state).

### Fetching GPS Trails (`messages/load_interval`)
To draw the blue travel route on the map, we request raw GPS messages for a specific timeframe.
* **Satellite Filtering:** Raw GPS data is messy. When a vehicle parks or goes under a roof, the GPS drifts wildly. To prevent the map route from "jumping" around at the end of a trip, our code strictly filters out any messages where `m.pos.sc` (Satellite Count) is less than 3. 
* **Mathematical Fallback:** If the Reporting API fails, our `TravelModule` manually iterates over the GPS points and calculates the distance using the Haversine formula (ignoring tiny jitter movements).

---

## 3. The Dynamic Reporting API (`getReportData`)

Wialon's Trip Detector is the "source of truth" for official mileage and parking durations. However, fetching reports is notoriously difficult because user-created report templates are often grouped by Day, Month, or Unit, resulting in deeply nested JSON tables.

To solve this, our app **bypasses the user's templates entirely**.

### Dynamic Template Injection
When the user clicks "View Daily Travel", we call `report/exec_report`. Instead of passing a saved Template ID, we dynamically inject our own `reportTemplate` object in the payload. 
* We request two flat tables: `unit_trips` and `unit_stays` (Parkings).
* We strictly define the columns as comma-separated strings (e.g., `"c": "time_begin,time_end,mileage"`). **Note:** Wialon rejects arrays here (Error 4).
* **Quirk Warning:** Wialon requires an empty `sch` (Schedule) object for every table definition. If omitted, the API returns Error 4 (Invalid Parameters).

### Extracting the Table Data (`report/select_result_rows`)
Running `exec_report` only generates the report on Wialon's servers. To actually get the data, we immediately call `report/select_result_rows`.
* The columns are mapped exactly as we requested in our dynamic template.
* **Parkings:** We iterate through the `unit_stays` table to extract the duration and `{y, x}` coordinates of every parking spot, injecting them into Leaflet map markers.
* **Mileage:** We iterate through the `unit_trips` table, stripping out text like "km" using Regex, and parse the exact official mileage float to display on the UI.

---

## 4. Map Controller (`MapController` class)

The app uses **Leaflet.js** (`L`) with an OpenStreetMap tile layer styled to look like a dark mode dashboard.
* **Live Markers:** Uses a custom SVG `divIcon` that pulses (using CSS animations) if the engine is ON (`#00d4ff`) or OFF (`#ef4444`).
* **Route Drawing:** Routes are drawn using `L.polyline`.
* **Route Decorations:** `[ S ]` Start and `[ E ]` End markers are dropped at the first and last coordinates of the GPS array. `[ P ]` markers are dropped using the coordinates harvested from the Wialon Reporting API.
