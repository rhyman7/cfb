// Game-time forecast for the weekly slate, fetched in the viewer's browser from
// Open-Meteo (free, no key). Venue cities are geocoded once and cached in the
// browser. Everything is best-effort: if a lookup fails, the card just shows no
// forecast. Indoor stadiums are labeled on the card and skipped here.

const WX_GEO = "https://geocoding-api.open-meteo.com/v1/search";
const WX_API = "https://api.open-meteo.com/v1/forecast";
const WX_DAYS = 16;                         // Open-Meteo's forecast horizon
const WX_GEO_CACHE = "cfb-wx-geo-v1";

const US_STATES = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado",
  CT: "Connecticut", DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas",
  KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts",
  MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico",
  NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma",
  OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
  VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
  PR: "Puerto Rico",
};

// WMO weather codes → icon + short label
function wxCode(c) {
  if (c === 0) return ["☀️", "Clear"];
  if (c === 1) return ["🌤", "Mostly clear"];
  if (c === 2) return ["⛅", "Partly cloudy"];
  if (c === 3) return ["☁️", "Cloudy"];
  if (c === 45 || c === 48) return ["🌫", "Fog"];
  if (c >= 51 && c <= 57) return ["🌦", "Drizzle"];
  if ((c >= 61 && c <= 67) || (c >= 80 && c <= 82)) return ["🌧", "Rain"];
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) return ["🌨", "Snow"];
  if (c >= 95) return ["⛈", "Thunderstorms"];
  return ["🌡", "Forecast"];
}

function wxLoadGeo() {
  try { return JSON.parse(localStorage.getItem(WX_GEO_CACHE)) || {}; } catch (e) { return {}; }
}
function wxSaveGeo(cache) {
  try { localStorage.setItem(WX_GEO_CACHE, JSON.stringify(cache)); } catch (e) { /* storage off: fine */ }
}

// "Blacksburg, VA" → {lat, lon}, or null. Non-US cities ("Dublin, Ireland") take the top hit.
async function wxGeocode(city) {
  const [name, region] = city.split(",").map(s => s.trim());
  const state = region && US_STATES[region.toUpperCase()];
  const params = new URLSearchParams({ name, count: "10", language: "en", format: "json" });
  if (state) params.set("countryCode", "US");
  const res = await fetch(`${WX_GEO}?${params}`);
  if (!res.ok) throw new Error("geocode HTTP " + res.status);
  const hits = (await res.json()).results || [];
  const hit = state ? hits.find(h => h.admin1 === state) : hits[0];
  return hit ? { lat: +hit.latitude.toFixed(3), lon: +hit.longitude.toFixed(3) } : null;
}

// Run async jobs a few at a time so ~60 venue lookups don't all fire at once.
async function wxPool(items, n, fn) {
  const queue = items.slice();
  await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => {
    while (queue.length) { const it = queue.shift(); try { await fn(it); } catch (e) { /* skip */ } }
  }));
}

const wxDay = d => d.toISOString().slice(0, 10);

function startWeather(games, rerender) {
  const now = Date.now();
  const horizon = now + (WX_DAYS - 1) * 24 * 3600 * 1000;
  const todo = games.filter(g => !g.completed && g.indoor !== true && g.city &&
    new Date(g.start).getTime() > now - 6 * 3600 * 1000 && new Date(g.start).getTime() < horizon);
  if (!todo.length) return;

  (async () => {
    const geo = wxLoadGeo();
    const cities = [...new Set(todo.map(g => g.city))];
    await wxPool(cities.filter(c => !(c in geo)), 4, async c => { geo[c] = await wxGeocode(c); });
    wxSaveGeo(geo);

    const places = cities.filter(c => geo[c]);
    const fc = {};
    // Open-Meteo takes several locations per request; keep URLs short.
    for (let i = 0; i < places.length; i += 20) {
      const chunk = places.slice(i, i + 20);
      const params = new URLSearchParams({
        latitude: chunk.map(c => geo[c].lat).join(","),
        longitude: chunk.map(c => geo[c].lon).join(","),
        hourly: "temperature_2m,precipitation_probability,weather_code,wind_speed_10m",
        daily: "weather_code,temperature_2m_max,precipitation_probability_max,wind_speed_10m_max",
        temperature_unit: "fahrenheit",
        wind_speed_unit: "mph",
        timezone: "GMT",
        forecast_days: String(WX_DAYS),
      });
      try {
        const res = await fetch(`${WX_API}?${params}`);
        if (!res.ok) continue;
        let body = await res.json();
        if (!Array.isArray(body)) body = [body];
        chunk.forEach((c, k) => { if (body[k] && body[k].hourly) fc[c] = body[k]; });
      } catch (e) { /* leave this chunk without a forecast */ }
    }

    let changed = false;
    todo.forEach(g => {
      const f = fc[g.city];
      if (!f) return;
      const start = new Date(g.start);
      if (g.timeTbd) {
        // No kickoff time yet: use the whole day (game date as shown in US Eastern time).
        const day = start.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
        const i = (f.daily.time || []).indexOf(day);
        if (i < 0 || f.daily.temperature_2m_max[i] == null) return;
        const [icon, text] = wxCode(f.daily.weather_code[i]);
        WX[g.id] = { icon, text, daily: true, temp: Math.round(f.daily.temperature_2m_max[i]),
          pop: f.daily.precipitation_probability_max[i], wind: Math.round(f.daily.wind_speed_10m_max[i]) };
      } else {
        // Nearest hour to kickoff, in GMT to match the API's timestamps.
        const hr = new Date(Math.round(start.getTime() / 3600000) * 3600000);
        const key = wxDay(hr) + "T" + hr.toISOString().slice(11, 16);
        const i = (f.hourly.time || []).indexOf(key);
        if (i < 0 || f.hourly.temperature_2m[i] == null) return;
        const [icon, text] = wxCode(f.hourly.weather_code[i]);
        WX[g.id] = { icon, text, temp: Math.round(f.hourly.temperature_2m[i]),
          pop: f.hourly.precipitation_probability[i], wind: Math.round(f.hourly.wind_speed_10m[i]) };
      }
      changed = true;
    });
    if (changed) rerender();
  })();
}
