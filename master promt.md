Act as a Full-Stack Telematics & UI Specialist. Build a temporary, client-ready demo dashboard that integrates with the Wialon REST API to showcase GPS tracking and automated attendance features.

### 🌐 Live Documentation & Reference Links

1. Read and parse Wialon API documentation: https://help.wialon.com/en/api/user-guide
2. Target Host API URL: https://hst-api.wialon.com/wialon/ajax.html
3. Permanent API Token: 828577d1ad4c4231b2b939032ad448a46F6C61E1F31B69C9816F9B79CB232B7799B51C50

---

### ⚙️ Core Technical Requirements

#### 1. Authentication & Session Management

- Automatically execute session login (`svc=token/login`) using the provided permanent API token to retrieve the active session ID (`eid`/`sid`).
- Implement automatic session recovery: If any API call returns `{"error": 1}`, automatically re-authenticate to generate a new session ID and retry the request.

#### 2. Unit Discovery

- Fetch available tracked units using `svc=core/search_items` (`itemsType: "avl_unit"`).
- Provide a unit selector dropdown in the dashboard sidebar.

---

### 🚀 Key Customer Features to Showcase

#### Feature 1: GPS Clock-In / Out Simulation

- **UI Element:** A "Simulate Employee Clock-In" button next to a live location card.
- **Backend Flow:** Trigger real-time location lookup using `svc=core/search_item` (`flags: 4194304`).
- **Data Capture:** Extract Latitude (`y`), Longitude (`x`), UTC Time (`t`), and Speed (`s`).
- **Address Resolution:** Call Wialon's reverse geocoding service `svc=address (gis_geocode)` or an open reverse-geocoding service to display human-readable address names alongside raw coordinates.
- **Verification Rule:** Display a visual indicator confirming "Stationary Check-In Verified" if speed `s == 0`.

#### Feature 2: Daily Travelled Distance & Interactive Map View

- **UI Element:** A date-picker input defaulting to "Today" alongside a "View Daily Travel" button.
- **Backend Flow:** Retrieve historical messages for the selected date range using `svc=messages/get_messages` (or execute a trip summary via `svc=report/exec_report`).
- **Display:**
  1. Show total distance traveled (in kilometers) for the selected day.
  2. Render an interactive map (using Leaflet.js / OpenStreetMap) showing marker pins for start/end points and drawing a polyline along the actual travel path.

#### Feature 3: Travel History & Date Range Route Playback

- **UI Element:** Date range filter (`Start Date/Time` to `End Date/Time`).
- **Display:** Display total accumulated distance over the selected period and render historical polyline routes on the map.

#### Feature 4: Location Master & Interactive Map Marker Picker

- **UI Element:** A "Location Master" management panel/modal with form fields:
  - `Location Name` (e.g., "Head Office", "Client Warehouse A", "Main Gate").
  - `Radius / Geofence Size` (e.g., 100m, 500m).
  - `Latitude` & `Longitude` (Read-only / Auto-populated input fields).
  - `Save Location` button.
- **Interactive Map Behavior:**
  - When the user clicks anywhere on the Leaflet map, drop/move a dynamic marker to that clicked position.
  - Automatically extract the `e.latlng.lat` and `e.latlng.lng` values and populate the Latitude & Longitude form fields in real-time.
  - Allow the user to drag the marker around to fine-tune the exact position before saving.
  - Display a list/table of saved locations in the Location Master sidebar, and when clicked, pan the map directly to that saved marker.

---

### 🎨 Design & Demo Guidelines

- **Look & Feel:** Clean, modern, dark/light theme designed to impress prospective clients during a demo.
- **Layout:** Responsive split-screen dashboard (Left: Control Panel/Sidebar with unit selection & action logs; Right: Full-height interactive map view).
- **Mocking/Fallback:** If physical vehicle GPS data is offline or stationary during the live test, generate smooth fallback mock route polylines based on the unit's last known coordinate so the client presentation remains visually engaging.

---

### 🧪 Browser Verification Tasks

Use your Chrome Browser subagent to:

1. Spin up the application locally.
2. Open the dashboard URL in the browser.
3. Test session creation, unit selection, and map rendering.
4. Verify that clicking "Clock-In" drops a pin on the map and updates the attendance log card.
5. Capture a screenshot/video recording of the verified dashboard once complete.
