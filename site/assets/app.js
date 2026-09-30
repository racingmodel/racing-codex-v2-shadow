(function () {
  "use strict";

  const runtime = window.RacingCodexRuntime;
  const FILES = Object.freeze({
    day: "day-summary.json",
    best: "best-bets.json",
    close: "close-calls.json",
    value: "was-value.json",
    live: "live-backtest.json",
    races: "racecards.json",
    runners: "runners-a-z.json",
    tony: "tony-watch.json",
    revival: "revival-watch.json",
    elo: "horse-elo.json",
    rank: "rank-overlay.json",
    forecast: "forecast-tricast-source.json",
    clear: "top-rated-clear.json",
    results: "results.json",
    health: "health-status.json"
  });
  const ALLOWED_SCHEMA = new Set([1]);
  const app = document.querySelector("#app");
  const dateInput = document.querySelector("#racing-date");
  const raceStrip = document.querySelector("#race-strip");
  const systemChip = document.querySelector("#system-chip");
  const snapshotTime = document.querySelector("#snapshot-time");
  const menuButton = document.querySelector(".menu-toggle");
  const nav = document.querySelector("#primary-nav");
  const liveBacktestState = document.querySelector("#live-backtest-state");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  const state = {
    date: new URLSearchParams(location.search).get("date") || localISODate(),
    dataBase: new URLSearchParams(location.search).get("data") || "../output/dashboard",
    releaseId: null,
    artifacts: {},
    errors: {},
    simulation: { mode: "finish", speed: 1, playing: !reducedMotion.matches }
  };

  function localISODate() {
    const now = new Date();
    return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("-");
  }

  function esc(value) {
    return runtime.escapeHTML(value);
  }

  function attr(value) { return esc(value); }
  function list(value) { return Array.isArray(value) ? value : []; }
  function records(value) { return list(value).filter(item => item && typeof item === "object" && !Array.isArray(item)); }
  function object(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
  function number(value) { return typeof value === "number" && Number.isFinite(value) ? value : null; }
  function text(value, fallback = "Unavailable") { return value === null || value === undefined || value === "" ? fallback : String(value); }
  function parseObject(value) {
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
    if (typeof value !== "string") return {};
    try { return object(JSON.parse(value)); } catch (_error) { return {}; }
  }
  function formatNumber(value, digits = 2) {
    const parsed = number(value);
    return parsed === null ? "Unavailable" : parsed.toLocaleString("en-GB", { maximumFractionDigits: digits, minimumFractionDigits: digits });
  }
  function formatInteger(value) {
    const parsed = number(value);
    return parsed === null ? "Unavailable" : Math.round(parsed).toLocaleString("en-GB");
  }
  function formatPercent(value, inputIsRatio = true) {
    const parsed = number(value);
    return parsed === null ? "Unavailable" : `${(inputIsRatio ? parsed * 100 : parsed).toFixed(1)}%`;
  }
  function formatDateTime(value) {
    if (!value) return "Unavailable";
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? text(value) : parsed.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
  }
  function racingDateLabel() {
    const parts = String(state.date).split("-").map(Number);
    if (parts.length !== 3 || parts.some(value => !Number.isInteger(value))) return text(state.date);
    const parsed = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 12));
    return parsed.toLocaleDateString("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC"
    });
  }
  function distanceLabel(yards) {
    const value = number(yards);
    if (value === null) return "Unavailable";
    const miles = Math.floor(value / 1760);
    const furlongs = Math.round((value % 1760) / 220);
    return `${miles ? `${miles}m ` : ""}${furlongs ? `${furlongs}f` : ""}`.trim() || `${Math.round(value)}y`;
  }
  function weightLabel(lbs) {
    const value = number(lbs);
    if (value === null) return "Unavailable";
    return `${Math.floor(value / 14)}-${String(Math.round(value % 14)).padStart(2, "0")}`;
  }
  function goingLabel(race) {
    const going = race?.going;
    return text(going && typeof going === "object" ? going.value : going);
  }
  function stateClass(value) {
    const normalized = String(value || "").toUpperCase();
    if (["OK", "HEALTHY", "SUCCESS", "AVAILABLE", "CONFIRMED", "WON", "PLACED", "READY"].includes(normalized)) return "healthy";
    if (["DEGRADED", "NOT_CONFIGURED", "PENDING", "OFF_SOON", "PAST_OFF", "INACTIVE", "CARD ONLY", "NOT ANALYSED"].includes(normalized)) return "degraded";
    if (["FAILED", "ERROR", "LOST", "BLOCKED", "IDENTITY BLOCKED"].includes(normalized)) return "failed";
    return "neutral";
  }
  function silkColour(index) {
    return ["#dc3d4b", "#2877de", "#f2bf35", "#793dd1", "#1fb773", "#ef6c2f", "#d53b9b", "#22a9be"][index % 8];
  }

  async function loadArtifact(key, filename) {
    const root = state.dataBase.replace(/\/$/, "");
    const url = new URL(`${root}/${encodeURIComponent(state.date)}/${filename}`, document.baseURI);
    if (state.releaseId) url.searchParams.set("release", state.releaseId);
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`${filename}: HTTP ${response.status}`);
    const payload = await response.json();
    if (!ALLOWED_SCHEMA.has(payload.schema_version)) throw new Error(`${filename}: unsupported schema ${payload.schema_version}`);
    if (payload.racing_date && payload.racing_date !== state.date) throw new Error(`${filename}: racing date mismatch`);
    return payload;
  }

  async function loadSnapshot() {
    app.innerHTML = document.querySelector("#loading-template").innerHTML;
    state.artifacts = {};
    state.errors = {};
    state.releaseId = null;
    try {
      const manifestUrl = new URL("../release-manifest.json", document.baseURI);
      const manifestResponse = await fetch(manifestUrl, { cache: "no-store" });
      if (manifestResponse.ok) {
        const manifest = await manifestResponse.json();
        if (manifest.schema_version === 1 && typeof manifest.release_id === "string") {
          state.releaseId = manifest.release_id;
        }
      }
    } catch (_error) {
      // Local previews and older releases have no public release manifest.
    }
    const entries = await Promise.all(Object.entries(FILES).map(async ([key, filename]) => {
      try { return [key, await loadArtifact(key, filename), null]; }
      catch (error) { return [key, null, error instanceof Error ? error.message : String(error)]; }
    }));
    entries.forEach(([key, payload, error]) => {
      if (payload) state.artifacts[key] = payload;
      if (error) state.errors[key] = error;
    });
    updateChrome();
    render();
  }

  function updateChrome() {
    dateInput.value = state.date;
    const dateLabel = racingDateLabel();
    const racesLink = document.querySelector('[data-route="races"]');
    if (racesLink) racesLink.textContent = `Races · ${dateLabel}`;
    const liveActive = state.artifacts.live?.summary?.activated === true;
    liveBacktestState.textContent = `Live backtest ${liveActive ? "active" : "inactive"}`;
    const generated = state.artifacts.day?.generated_at_utc || state.artifacts.races?.generated_at_utc;
    snapshotTime.textContent = generated ? `Snapshot ${formatDateTime(generated)}` : "Snapshot unavailable";
    const health = object(state.artifacts.health?.health);
    const criticalFailure = Object.values(health).some(item => String(object(item).status || "").toUpperCase() === "FAILED");
    systemChip.className = `status-chip ${criticalFailure ? "failed" : Object.keys(state.errors).length ? "degraded" : "healthy"}`;
    systemChip.textContent = criticalFailure ? "System issue" : Object.keys(state.errors).length ? "Partial data" : "System online";
    const races = list(state.artifacts.races?.races).slice().sort((a, b) => String(a.off_time_local).localeCompare(String(b.off_time_local)));
    raceStrip.innerHTML = races.map(race => `<a class="race-link" href="#race/${attr(race.race_id)}"><strong>${esc(text(race.off_time_local, "--:--"))}</strong> ${esc(text(race.course))}</a>`).join("");
  }

  function route() {
    const raw = location.hash.replace(/^#/, "") || "home";
    const [name, ...parts] = raw.split("/");
    return { name, id: decodeURIComponent(parts.join("/")) };
  }

  function runners() { return records(state.artifacts.runners?.items); }
  function races() { return records(state.artifacts.races?.races); }
  function raceLocalTime(raceId, fallback) {
    const race = races().find(item => String(item.race_id) === String(raceId));
    return text(race?.off_time_local, fallback);
  }
  function runnersForRace(raceId) {
    return runners().filter(item => String(item.race_id) === String(raceId)).sort((a, b) => (a.p4?.model_rank ?? 999) - (b.p4?.model_rank ?? 999));
  }
  function decisionEvidence(item) { return object(item?.evidence || parseObject(item?.evidence_json)); }
  function adviceSnapshot(item) { return object(item.advice || parseObject(item.snapshot_json)); }
  function latestResults() {
    const result = new Map();
    records(state.artifacts.results?.items).forEach(item => result.set(`${item.race_id}:${item.horse_id}`, item));
    return result;
  }
  function resultState(item) {
    const observation = object(item?.observation || parseObject(item?.observation_json));
    return runtime.raceResultLabel(observation, item?.completeness);
  }

  function emptyState(title, detail) {
    return `<div class="empty-state"><strong>${esc(title)}</strong><p>${esc(detail)}</p></div>`;
  }
  function panel(title, body, options = {}) {
    return `<section class="panel ${attr(options.className || "")}"><header class="panel-head"><div><h2>${esc(title)}</h2>${options.subtitle ? `<p>${esc(options.subtitle)}</p>` : ""}</div>${options.action || ""}</header><div class="panel-body">${body}</div></section>`;
  }
  function unavailable(title, detail) {
    return panel(title, `<div class="availability"><span class="status-chip neutral">Not available</span><p>${esc(detail)}</p></div>`);
  }

  function setActiveNav(name) {
    document.querySelectorAll("[data-route]").forEach(link => link.classList.toggle("active", link.dataset.route === name));
    nav.classList.remove("open");
    menuButton.setAttribute("aria-expanded", "false");
  }

  window.RacingCodex = Object.freeze({ esc, distanceLabel, weightLabel, resultState });

  function betBadge(type) {
    const raw = String(type || "UNAVAILABLE").toUpperCase();
    const value = raw === "EACH_WAY" || raw === "EACH WAY" ? "E/W" : raw.replaceAll("_", " ");
    const klass = value === "WIN" ? "win" : value === "E/W" ? "each-way" : value.includes("LAY") ? "lay" : "neutral";
    return `<span class="bet-badge ${klass}">${esc(value)}</span>`;
  }

  function adviceRows(items, kind = "advice") {
    items = records(items);
    if (!items.length) return emptyState(
      kind === "close" ? "No Close Calls" : kind === "value" ? "No Was Value history" : "No admitted selections",
      kind === "close" ? "No runner narrowly missed the authoritative Phase 8A thresholds in this snapshot." : kind === "value" ? "No earlier admitted selection has moved to Was Value in this snapshot." : "The authoritative backend did not admit a selection for this racing date."
    );
    const results = latestResults();
    const rows = items.map((item, index) => {
      const advice = adviceSnapshot(item);
      const evidence = decisionEvidence(item);
      const trace = object(evidence.decision_trace || advice.decision_trace);
      const models = object(advice.models);
      const prices = object(advice.prices);
      const failed = list(evidence.failed_conditions || trace.failed_conditions)[0] || {};
      const horse = advice.horse || evidence.horse || trace.horse || item.horse_id;
      const raceId = advice.race_id || item.race_id;
      const result = results.get(`${raceId}:${advice.horse_id || item.horse_id}`);
      const decisionResult = item.settlement ? runtime.settlementLabel(item.settlement) : resultState(result);
      if (kind === "close") {
        const candidate = evidence.candidate_decision_type || failed.action || "WATCH";
        return `<tr><td>${esc(raceLocalTime(raceId, text(item.observed_at_utc, "—").slice(11, 16)))}</td><td><a href="#race/${attr(raceId)}">${esc(text(races().find(r => r.race_id === raceId)?.course))}</a></td><td><span class="silk" style="--silk:${silkColour(index)}">${index + 1}</span><span class="horse-name">${esc(text(horse))}</span></td><td>${betBadge(candidate)}</td><td>${esc(text(failed.field || failed.name || item.reason))}<span class="subline">${esc(text(failed.requirement || list(evidence.promotion_dependencies)[0]))}</span></td><td class="value-negative">${esc(text(failed.distance))}</td><td>${esc(text(failed.actual))}</td><td>${esc(text(failed.requirement || failed.threshold))}</td></tr>`;
      }
      const current = evidence.latest_price ?? object(trace.price_semantics).policy_price;
      const terms = object(advice.each_way_terms);
      const extraPlaces = terms.bookmaker && terms.places_paid
        ? `${text(terms.bookmaker)} ×${text(terms.places_paid)}${number(terms.fraction) === null ? " · fraction unavailable" : ` · 1/${Math.round(1 / terms.fraction)}`}`
        : "No frozen extra-place terms";
      const priceCell = `<strong class="real-price">${esc(formatNumber(prices.displayed_odds))}</strong><span class="subline">${esc(text(prices.price_source, "Source unavailable"))}</span>${advice.decision_type === "EACH_WAY" ? `<span class="subline">${esc(extraPlaces)}</span>` : ""}`;
      const laterCell = current === undefined ? "Unavailable" : `<span class="price-box">${esc(formatNumber(current))}</span>`;
      const supportTags = list(advice.support_evidence).slice(0, 3);
      const evidenceCell = `${supportTags.map(tag => `<span class="tag">${esc(tag)}</span>`).join(" ") || `<span class="subline">${esc(text(advice.underlying_route))}</span>`}${supportTags.length ? `<span class="subline">${esc(text(advice.underlying_route))}</span>` : ""}`;
      return `<tr><td>${esc(raceLocalTime(raceId, text(advice.off_at_utc, "—").slice(11, 16)))}</td><td><a href="#race/${attr(raceId)}">${esc(text(advice.course || races().find(r => r.race_id === raceId)?.course))}</a></td><td><span class="silk" style="--silk:${silkColour(index)}">${index + 1}</span><span class="horse-name">${esc(text(horse))}</span></td><td>${betBadge(advice.decision_type || advice.underlying_route)}</td><td>${priceCell}</td><td>${laterCell}<span class="subline">Later observation</span></td><td><span class="price-box model-price">${esc(formatNumber(models.p4_model_odds))}</span><span class="subline">Raw ${esc(formatNumber(models.p4_raw_odds))}</span></td><td>${esc(formatPercent(models.p4_win_probability))}</td><td><span class="rank-box">${esc(text(models.p4_rank, "—"))}</span></td><td>${evidenceCell}</td><td>${esc(decisionResult)}</td><td><button class="btn add-bet" data-advice="${attr(item.advice_id || "")}" data-race="${attr(raceId)}" data-horse="${attr(advice.horse_id || item.horse_id)}" data-name="${attr(horse)}" data-type="${attr(advice.decision_type || "WIN")}" data-price="${attr(prices.displayed_odds || "")}">My Bets</button></td></tr>`;
    }).join("");
    const headers = kind === "close"
      ? "<th>Time</th><th>Course</th><th>Horse</th><th>Potential</th><th>Failed condition</th><th>Distance</th><th>Actual</th><th>Requirement</th>"
      : "<th>Time</th><th>Course</th><th>Horse</th><th>Bet type</th><th>Real / bookmaker</th><th>Later price</th><th>Model / raw</th><th>P4 win</th><th>Rank</th><th>Evidence</th><th>Result / settlement</th><th></th>";
    return `<div class="table-wrap"><table class="data-table"><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  function meetingSummary() {
    const grouped = new Map();
    races().forEach(race => {
      const key = text(race.course);
      const group = grouped.get(key) || [];
      group.push(race);
      grouped.set(key, group);
    });
    if (!grouped.size) return emptyState("No analysed races", "No racecard read model is available for this date.");
    return [...grouped.entries()].map(([course, items]) => {
      const ordered = items.sort((a, b) => String(a.off_time_local).localeCompare(String(b.off_time_local)));
      return `<div class="health-row"><span class="health-dot ${stateClass(ordered[0].lifecycle)}"></span><strong>${esc(course)}</strong><span>${items.length} race${items.length === 1 ? "" : "s"} · first ${esc(text(ordered[0].off_time_local))} · ${esc(text(ordered[0].lifecycle).replaceAll("_", " "))}</span></div>`;
    }).join("");
  }

  function healthSummary(limit = 7) {
    const health = object(state.artifacts.health?.health);
    const preferred = ["discover_today", "market", "historical_freshness", "analysis_decisions", "results", "settlement", "static_artifacts"];
    const entries = preferred.filter(key => health[key]).map(key => [key, health[key]]).slice(0, limit);
    if (!entries.length) return emptyState("Health unavailable", "The health-status artifact is unavailable for this snapshot.");
    return `<div class="health-list">${entries.map(([name, value]) => {
      const item = object(value);
      const status = item.status || (item.errors?.length ? "FAILED" : item.warnings?.length ? "DEGRADED" : "HEALTHY");
      return `<div class="health-row"><span class="health-dot ${stateClass(status)}"></span><span>${esc(name.replaceAll("_", " "))}<small class="subline">${esc(text(list(item.warnings)[0] || list(item.errors)[0], "No reported issue"))}</small></span><strong class="${stateClass(status)}">${esc(text(status).replaceAll("_", " "))}</strong></div>`;
    }).join("")}</div>`;
  }

  function liveBacktestCard() {
    const summary = object(state.artifacts.live?.summary);
    const active = summary.activated === true;
    const activation = active && summary.activated_at_utc ? ` Activated ${formatDateTime(summary.activated_at_utc)}.` : "";
    return `<div class="panel-body"><span class="status-chip ${active ? "healthy" : "degraded"}">${active ? "Active" : "Inactive"}</span><p>${active ? `Official forward-only performance.${activation}` : "Not yet activated. TEST and REPLAY records are excluded."}</p><div class="kpis"><div class="kpi"><strong>${esc(formatInteger(summary.selections ?? 0))}</strong><span>Selections</span></div><div class="kpi"><strong>${esc(formatInteger(summary.settled ?? 0))}</strong><span>Settled</span></div><div class="kpi"><strong>${esc(formatNumber(summary.profit_loss ?? 0))}</strong><span>P/L</span></div><div class="kpi"><strong>${summary.roi === null || summary.roi === undefined ? "—" : esc(formatPercent(summary.roi))}</strong><span>ROI</span></div></div></div>`;
  }

  function researchSummaryCard() {
    const research = object(state.artifacts.day?.research_evidence);
    if (research.availability !== "AVAILABLE") return `<span class="status-chip neutral">Unavailable</span><p>Prospective research status is not present in this snapshot.</p>`;
    const gates = object(research.gates);
    const notReady = Object.entries(gates).filter(([, status]) => status !== "READY").length;
    return `<div class="kpis"><div class="kpi"><strong>${esc(formatInteger(research.captured_races))}</strong><span>Captured races</span></div><div class="kpi"><strong>${esc(formatInteger(research.captured_runners))}</strong><span>Captured runners</span></div><div class="kpi"><strong>${esc(formatInteger(research.complete_labelled_win_books))}</strong><span>Labelled WIN books</span></div><div class="kpi"><strong>${notReady}</strong><span>Gates not ready</span></div></div>`;
  }

  function renderCloseCalls() {
    return panel("Close Calls · not bets", adviceRows(records(state.artifacts.close?.items), "close"), { subtitle: "Authoritative backend near-miss output; failed conditions remain visible" });
  }

  function renderWasValue() {
    return panel("Was Value Earlier Today", adviceRows(records(state.artifacts.value?.items), "value"), { subtitle: "Frozen original bookmaker, price and decision evidence; later price is separate" });
  }

  function renderLiveBacktest() {
    const summary = object(state.artifacts.live?.summary);
    const groups = object(summary.groups);
    const routes = object(groups.underlying_route);
    const rows = Object.entries(routes).map(([routeName, item]) => `<tr><td>${esc(routeName)}</td><td>${esc(formatInteger(item.selections))}</td><td>${esc(formatInteger(item.settled))}</td><td>${esc(formatNumber(item.stake))}</td><td>${esc(formatNumber(item.returns))}</td><td>${esc(formatNumber(item.profit_loss))}</td></tr>`).join("");
    const breakdown = rows ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Actual route</th><th>Bets</th><th>Settled</th><th>Stake</th><th>Returns</th><th>P/L</th></tr></thead><tbody>${rows}</tbody></table></div>` : emptyState("No route breakdown yet", "No immutable official advice has been recorded for a breakdown.");
    return `<div class="stack">${panel("Official Live Backtest", liveBacktestCard(), { subtitle: "Actual LIVE ledger advice plus settlement only" })}${panel("Route breakdown", breakdown, { subtitle: "TEST, REPLAY and My Bets are excluded" })}<p class="subline">${esc(text(summary.small_sample_note, "Descriptive results only"))}</p></div>`;
  }

  function renderResearch() {
    const research = object(state.artifacts.day?.research_evidence);
    if (research.availability !== "AVAILABLE") return unavailable("Prospective research", "Research status is unavailable in this dashboard snapshot. The browser does not calculate or advance research gates.");
    const discipline = object(research.discipline_races);
    const gates = object(research.gates);
    const gateRows = Object.entries(gates).map(([name, status]) => `<div class="health-row"><span class="health-dot ${status === "READY" ? "healthy" : "degraded"}"></span><span>${esc(name.replaceAll("_", " "))}</span><strong>${esc(text(status))}</strong></div>`).join("");
    return `<div class="stack">${panel("Prospective CURRENT-P4 evidence", `<div class="kpis"><div class="kpi"><strong>${esc(formatInteger(research.days))}</strong><span>Days captured</span></div><div class="kpi"><strong>${esc(formatInteger(research.captured_races))}</strong><span>Unique races</span></div><div class="kpi"><strong>${esc(formatInteger(research.captured_runners))}</strong><span>Unique race runners</span></div><div class="kpi"><strong>${esc(formatInteger(research.complete_labelled_win_books))}</strong><span>Complete WIN books</span></div><div class="kpi"><strong>${esc(formatInteger(research.complete_labelled_place_books))}</strong><span>Complete PLACE books</span></div><div class="kpi"><strong>${esc(formatInteger(research.unresolved_runner_labels))}</strong><span>Unresolved labels</span></div></div><div class="discipline-row"><span>Flat turf ${esc(formatInteger(discipline.flat_turf))}</span><span>AW ${esc(formatInteger(discipline.aw))}</span><span>Jumps ${esc(formatInteger(discipline.jumps))}</span><span>Unknown ${esc(formatInteger(discipline.unknown))}</span></div>`, { subtitle: "One canonical pre-off snapshot per race; labels are separate" })}${panel("Readiness gates", gateRows || emptyState("No gates", "No gate status is available."), { subtitle: "Evidence status only · optimisation never starts automatically" })}</div>`;
  }

  function renderHome() {
    const day = object(state.artifacts.day);
    const best = records(state.artifacts.best?.items);
    const close = records(state.artifacts.close?.items);
    const value = records(state.artifacts.value?.items);
    const meetings = new Set(races().map(race => race.course)).size;
    const dateLabel = racingDateLabel();
    return `<section class="hero"><div class="hero-main"><p class="eyebrow">${esc(dateLabel)} · DECISION DESK</p><h1>Today, with discipline.</h1><p>P4 is primary. Phase 8A admissions are the only Best Bets. Missing evidence stays visible.</p><div class="proof-row"><div class="proof"><span class="proof-icon">↗</span><span><b>Primary</b>P4 suitability</span></div><div class="proof"><span class="proof-icon">◎</span><span><b>Decision</b>Frozen Phase 8A</span></div><div class="proof"><span class="proof-icon">◇</span><span><b>Evidence</b>Source-specific</span></div></div></div><aside class="panel glance" aria-label="${attr(dateLabel)} at a glance"><div class="metric"><strong>${meetings}</strong><span>Meetings</span></div><div class="metric"><strong>${races().length}</strong><span>Racecards</span></div><div class="metric"><strong>${formatInteger(day.runners ?? runners().length)}</strong><span>Modelled runners</span></div><div class="metric"><strong>${list(state.artifacts.results?.items).length}</strong><span>Result observations</span></div><div class="metric"><strong>${best.length}</strong><span>Phase8A Best Bets</span></div><div class="metric"><strong>${close.length}</strong><span>Close Calls</span></div><div class="metric"><strong>${value.length}</strong><span>Was Value</span></div><div class="metric"><strong>${formatInteger(object(state.artifacts.live?.summary).settled ?? 0)}</strong><span>Official settled</span></div></aside></section>
      <div class="dashboard-grid">
        <section class="panel span-3"><header class="panel-head"><div><h2>★ Best Bets — ${esc(dateLabel)}</h2><p>Authoritative Phase 8A ADMITTED selections only</p></div><a class="btn" href="#best-bets">View all</a></header>${adviceRows(best)}</section>
        <section class="panel accent-orange span-2"><header class="panel-head"><div><h2>◉ Close Calls</h2><p>Near misses — policy unchanged</p></div></header>${adviceRows(close, "close")}</section>
        <section class="panel accent-blue"><header class="panel-head"><div><h2>↘ Was Value Earlier</h2><p>Immutable original advice</p></div></header>${adviceRows(value, "value")}</section>
        ${panel(`Races — ${dateLabel}`, meetingSummary(), { subtitle: "Meetings, analysed races and explicit blocks" })}
        <section class="panel"><header class="panel-head"><div><h2>Live Backtest</h2><p>Official forward performance</p></div></header>${liveBacktestCard()}</section>
        ${panel("My Bets", `<p>Personal bets stay in this browser and never enter the official ledger.</p><a class="btn primary" href="#my-bets">Open My Bets</a>`, { subtitle: "Separate from model performance" })}
        ${panel("System Health", healthSummary(), { action: '<a class="btn" href="#health">Details</a>' })}
        ${panel("Research evidence", researchSummaryCard(), { action: '<a class="btn" href="#research">View evidence</a>' })}
      </div>`;
  }

  function raceHeader(race, active = "racecard") {
    return `<section class="race-hero"><div class="race-time">${esc(text(race.off_time_local, "--:--"))}</div><div class="race-identity"><p class="eyebrow">${esc(text(race.lifecycle, "Status unavailable").replaceAll("_", " "))}</p><h1>${esc(text(race.course))}</h1><p>${esc(text(race.race_name))}</p><div class="race-meta"><span>${esc(text(race.race_type))}</span><span>${esc(text(race.distance, distanceLabel(race.distance_yards)))}</span><span>${esc(goingLabel(race))}</span><span>${esc(race.race_class === undefined ? "Class unavailable" : `Class ${race.race_class}`)}</span><span>${esc(text(race.runner_count))} runners</span></div></div><div class="race-tools"><span class="status-chip ${stateClass(race.lifecycle)}">${esc(text(race.p4_status, text(race.lifecycle).replaceAll("_", " ")))}</span><span class="tag">${esc(text(race.mode, "Read model"))}</span></div></section><nav class="race-tabs" aria-label="Race views"><a class="${active === "racecard" ? "active" : ""}" href="#race/${attr(race.race_id)}">Racecard</a><a class="${active === "simulation" ? "active" : ""}" href="#simulation/${attr(race.race_id)}">Simulation</a><a href="#rank-overlay">Rank Overlay</a><a href="#forecast">Predictions</a></nav>`;
  }

  function contributionSummary(runner) {
    const ledger = records(runner.p4?.ledger)
      .filter(item => number(item.contribution) !== null && Math.abs(item.contribution) > 0)
      .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
      .slice(0, 8);
    if (!ledger.length) return `<span class="subline">Component ledger unavailable</span>`;
    return `<details class="evidence"><summary>Model contribution trace</summary><div class="evidence-grid">${ledger.map(item => `<div class="evidence-item"><span>${esc(text(item.component).replaceAll("_", " "))}</span><strong class="${item.contribution >= 0 ? "positive" : "negative"}">${item.contribution >= 0 ? "+" : ""}${esc(formatNumber(item.contribution))}</strong><small class="subline">${esc(text(item.stage))}${item.multiplier !== null && item.multiplier !== undefined ? ` · ×${esc(formatNumber(item.multiplier, 3))}` : ""}</small></div>`).join("")}</div></details>`;
  }

  function supportBlock(runner, model) {
    const block = object(runner.supporting_models?.[model]);
    return block.availability && block.availability !== "AVAILABLE" ? null : block;
  }

  function supportLabel(runner, model, display) {
    const raw = object(runner.supporting_models?.[model]);
    if (raw.availability === "AVAILABLE" || !raw.availability) return display;
    const reason = raw.reason || raw.freshness?.reason || raw.freshness?.status || raw.availability;
    return `${text(raw.availability).replaceAll("_", " ")} · ${text(reason, "No reason supplied")}`;
  }

  function contextOverlayDetails(runner) {
    const overlay = object(runner.context_overlay);
    const families = records(overlay.families);
    if (!Object.keys(overlay).length) return `<p class="subline">Context overlay trace unavailable in this saved analysis.</p>`;
    const qualified = families.filter(item => ["positive", "negative"].includes(String(item.qualifies || "").toLowerCase()));
    const familyRows = families.map(item => `<div class="evidence-item"><span>${esc(text(item.family))}</span><strong class="${String(item.qualifies).toLowerCase() === "positive" ? "positive" : String(item.qualifies).toLowerCase() === "negative" ? "negative" : ""}">${esc(text(item.qualifies, "neutral").toUpperCase())}</strong><small class="subline">${esc(text(item.status))}${item.value === null || item.value === undefined ? " · unavailable" : ` · ${esc(formatNumber(item.value))}`}${item.source ? ` · ${esc(text(item.source))}` : ""}</small>${item.reason ? `<small class="subline">${esc(text(item.reason))}</small>` : ""}${item.as_of ? `<small class="subline">As of ${esc(text(item.as_of))}</small>` : ""}</div>`).join("");
    const pre = runner.p4?.composite_score_pre_context;
    const post = runner.p4?.composite_score;
    const preLabel = pre === null || pre === undefined ? "Unavailable / not captured" : formatNumber(pre);
    return `<details class="evidence"><summary>Context overlay · ${esc(formatPercent(number(overlay.context_overlay_coverage) === null ? null : overlay.context_overlay_coverage / 100, true))} coverage</summary><p>Pre-context Composite: ${esc(preLabel)} · backend adjustment ${esc(text(overlay.bounded_adjustment_percent, "Unavailable"))}% · final Composite: ${esc(formatNumber(post))}. ${esc(text(overlay.positive_family_count, "0"))} positive / ${esc(text(overlay.negative_family_count, "0"))} negative families${overlay.coverage_gate_applied ? " · positive movement coverage gate applied" : ""}.</p>${qualified.length ? `<p class="subline">Qualifying: ${qualified.map(item => esc(text(item.family))).join(" · ")}</p>` : ""}<div class="evidence-grid">${familyRows}</div></details>`;
  }

  function currentCloseCall(runner) {
    return records(state.artifacts.close?.items).find(item =>
      String(item.race_id) === String(runner.race_id) && String(item.horse_id) === String(runner.horse_id)
    );
  }

  function decisionPresentation(runner) {
    const outcome = object(runner.decision_trace?.outcome);
    const status = String(outcome.status || "UNAVAILABLE").toUpperCase();
    if (status === "ADMITTED") return { label: "BEST BET", detail: text(outcome.route, "Phase 8A admitted"), klass: "healthy" };
    if (status === "UNAVAILABLE") return { label: "UNAVAILABLE", detail: "Required decision evidence missing", klass: "neutral" };
    const close = currentCloseCall(runner);
    const nearMiss = object(decisionEvidence(close).near_miss);
    return {
      label: "NO BET",
      detail: close ? `Close Call · ${text(nearMiss.route, "single near miss")}` : text(outcome.route, "Phase 8A rejected"),
      klass: close ? "degraded" : "neutral"
    };
  }

  function supportingModelCell(runner) {
    const classic = supportBlock(runner, "classic_elo");
    const weightMargin = supportBlock(runner, "weight_margin_elo");
    const p5 = supportBlock(runner, "p5");
    const qve = supportBlock(runner, "qve");
    return {
      classic: supportLabel(runner, "classic_elo", classic ? `${formatNumber(classic.pre_race_rating, 0)} · #${text(classic.rank, "—")} · Δ ${formatNumber(classic.last_change, 1)}` : "Unavailable"),
      weightMargin: supportLabel(runner, "weight_margin_elo", weightMargin ? `${formatNumber(weightMargin.pre_race_rating, 0)} · #${text(weightMargin.rank, "—")}` : "Unavailable"),
      p5: supportLabel(runner, "p5", p5 ? `Place4 ${formatPercent(p5.p5_place4_prob)} · #${text(p5.p5_place4_rank, "—")} · Win ${formatPercent(p5.p5_win_prob)}` : "Unavailable"),
      qve: supportLabel(runner, "qve", qve ? `Score ${formatNumber(qve.qve_score)} · Agree ${text(qve.agreement_count, "0")} · ${text(qve.alignment_state, "State unavailable")}` : "Unavailable")
    };
  }

  function runnerRows(items) {
    const results = latestResults();
    return items.map((runner, index) => {
      const card = object(runner.racecard);
      const p4 = object(runner.p4);
      const bookmaker = object(runner.bookmaker_quote);
      const betfair = object(runner.betfair_win_quote);
      const support = supportingModelCell(runner);
      const decision = decisionPresentation(runner);
      const result = results.get(`${runner.race_id}:${runner.horse_id}`);
      const extra = bookmaker.bookmaker && bookmaker.number_of_places
        ? `${bookmaker.bookmaker} ×${bookmaker.number_of_places}${number(bookmaker.place_fraction) === null ? "" : ` · 1/${Math.round(1 / bookmaker.place_fraction)}`}`
        : "Extra places unavailable";
      return `<tr><td><span class="rank-box">${esc(text(p4.model_rank, "—"))}</span></td><td>${esc(formatNumber(p4.composite_score))}${contextOverlayDetails(runner)}</td><td>${esc(text(card.recent_form, "—"))}</td><td><span class="silk" style="--silk:${silkColour(index)}">${esc(text(card.number, text(card.draw, index + 1)))}</span><span class="horse-name">${esc(text(runner.horse))}</span><span class="subline">${esc(text(card.trainer))} · ${esc(text(card.jockey))}</span>${contributionSummary(runner)}</td><td>${esc(text(card.age, "—"))}<span class="subline">${esc(weightLabel(card.weight_lbs))} · OR ${esc(text(card.official_rating, "—"))}</span></td><td><strong>${esc(formatPercent(p4.win_probability))}</strong><span class="subline">Place ${esc(formatPercent(p4.place_probability))}</span></td><td><span class="price-box model-price">${esc(formatNumber(p4.model_odds))}</span></td><td>${esc(formatNumber(p4.raw_odds))}</td><td>${bookmaker.decimal_odds === undefined ? "Unavailable" : `<span class="price-box">${esc(formatNumber(bookmaker.decimal_odds))}</span>`}<span class="subline">${esc(text(bookmaker.bookmaker_name, "Sky Bet"))}</span><span class="subline">${esc(extra)}</span></td><td>${betfair.best_back === undefined ? "Unavailable" : `<span class="price-box">${esc(formatNumber(betfair.best_back))}</span>`}<span class="subline">Betfair WIN back / lay ${esc(formatNumber(betfair.best_lay))}</span></td><td>${esc(support.classic)}<span class="subline">Classic ELO · supporting</span></td><td>${esc(support.weightMargin)}<span class="subline">W+M · shadow</span></td><td>${esc(support.p5)}</td><td>${esc(support.qve)}</td><td><span class="tag ${decision.klass}">${esc(decision.label)}</span><span class="subline">${esc(decision.detail)}</span></td><td>${esc(resultState(result))}</td></tr>`;
    }).join("");
  }

  function runnerCards(items, alwaysVisible = false) {
    return `<div class="runner-cards${alwaysVisible ? " always-visible" : ""}">${items.map((runner, index) => {
      const card = object(runner.racecard);
      const p4 = object(runner.p4);
      const bookmaker = object(runner.bookmaker_quote);
      const betfair = object(runner.betfair_win_quote);
      const support = supportingModelCell(runner);
      const decision = decisionPresentation(runner);
      const extra = bookmaker.bookmaker && bookmaker.number_of_places
        ? `${bookmaker.bookmaker} ×${bookmaker.number_of_places}${number(bookmaker.place_fraction) === null ? "" : ` · 1/${Math.round(1 / bookmaker.place_fraction)}`}`
        : "Extra places unavailable";
      if (runner.identity_status) return `<article class="runner-card ${runner.identity_status === "IDENTITY BLOCKED" ? "blocked-card" : ""}"><header><div><span class="silk" style="--silk:${silkColour(index)}">${esc(text(card.cloth, text(card.draw, index + 1)))}</span><h3 class="horse-name">${esc(text(runner.horse))}</h3><span class="subline">${esc(text(card.trainer))} · ${esc(text(card.jockey))}</span></div><span class="status-chip ${runner.identity_status === "IDENTITY BLOCKED" ? "failed" : "neutral"}">${esc(runner.identity_status === "IDENTITY BLOCKED" ? "Identity blocked" : "Card only")}</span></header><p>${esc(text(runner.availability_reason, "P4 analysis unavailable"))}</p><span class="subline">Card evidence only · no P4 score, rank or price inferred</span></article>`;
      return `<article class="runner-card"><header><div><span class="silk" style="--silk:${silkColour(index)}">${esc(text(card.number, text(card.draw, index + 1)))}</span><h3 class="horse-name">${esc(text(runner.horse))}</h3><span class="subline">${esc(text(card.trainer))} · ${esc(text(card.jockey))}</span></div><span class="rank-box">${esc(text(p4.model_rank, "—"))}</span></header><h4>P4 · Primary</h4><dl><div><dt>Composite Score</dt><dd>${esc(formatNumber(p4.composite_score))}</dd></div><div><dt>Rank</dt><dd>${esc(text(p4.model_rank, "—"))}</dd></div><div><dt>Win / Place</dt><dd>${esc(formatPercent(p4.win_probability))} / ${esc(formatPercent(p4.place_probability))}</dd></div><div><dt>Model / Raw Odds</dt><dd>${esc(formatNumber(p4.model_odds))} / ${esc(formatNumber(p4.raw_odds))}</dd></div></dl>${contextOverlayDetails(runner)}<h4>Real / bookmaker</h4><dl><div><dt>${esc(text(bookmaker.bookmaker_name, "Bookmaker"))}</dt><dd>${esc(formatNumber(bookmaker.decimal_odds))}</dd></div><div><dt>Extra places</dt><dd>${esc(extra)}</dd></div><div><dt>Betfair WIN (separate)</dt><dd>${esc(formatNumber(betfair.best_back))} back · ${esc(formatNumber(betfair.best_lay))} lay</dd></div></dl><h4>Supporting evidence</h4><dl class="single-column"><div><dt>Classic ELO · supporting</dt><dd>${esc(support.classic)}</dd></div><div><dt>W+M · shadow</dt><dd>${esc(support.weightMargin)}</dd></div><div><dt>P5</dt><dd>${esc(support.p5)}</dd></div><div><dt>QVE</dt><dd>${esc(support.qve)}</dd></div><div><dt>ATR</dt><dd>Unavailable</dd></div></dl><h4>Phase 8A decision</h4><p><span class="tag ${decision.klass}">${esc(decision.label)}</span><span class="subline">${esc(decision.detail)}</span></p>${contributionSummary(runner)}</article>`;
    }).join("")}</div>`;
  }

  function renderRace(raceId) {
    const race = races().find(item => String(item.race_id) === String(raceId)) || races()[0];
    if (!race) return emptyState("Racecard unavailable", "No analysed racecard exists in this snapshot.");
    const items = runnersForRace(race.race_id);
    const meta = `<div class="kpis"><div class="kpi"><strong>${esc(text(race.provider_race_id, "—"))}</strong><span>Provider race identity</span></div><div class="kpi"><strong>${esc(formatDateTime(race.as_of_utc))}</strong><span>Analysis as of</span></div><div class="kpi"><strong>${esc(text(race.surface))}</strong><span>Surface</span></div><div class="kpi"><strong>${esc(text(race.handicap))}</strong><span>Handicap</span></div></div>`;
    const blocked = String(race.p4_status || "").toUpperCase() === "BLOCKED";
    const blockNotice = blocked ? `<div class="notice warning"><strong>P4 withheld for complete-field identity safety</strong><p>${esc(text(race.block_reason, "An unresolved runner prevents safe full-field analysis."))}</p></div>` : "";
    const cardOnly = !race.analysed;
    const table = items.length ? blocked || cardOnly ? runnerCards(items, true) : `<div class="desktop-table table-wrap"><table class="data-table intelligence-table"><thead><tr><th>P4 Rank</th><th>P4 Score</th><th>Form</th><th>Horse / connections</th><th>Age / wt / OR</th><th>Win / Place</th><th>Model Odds</th><th>Raw Odds</th><th>Bookmaker</th><th>Betfair WIN back / lay</th><th>Classic ELO</th><th>W+M ELO</th><th>P5 Place4 / Win</th><th>QVE</th><th>Phase 8A</th><th>Result</th></tr></thead><tbody>${runnerRows(items)}</tbody></table></div>${runnerCards(items)}` : emptyState("Runner detail unavailable", "This race exists in the read model but no runner analysis is available.");
    return `<div class="stack">${raceHeader(race)}${meta}${blockNotice}<section class="panel"><header class="panel-head"><div><h2>Detailed racecard</h2><p>Backend model and evidence truth — unavailable fields are never shown as zero</p></div>${blocked ? "" : `<a class="btn primary" href="#simulation/${attr(race.race_id)}">Open simulation</a>`}</header>${table}</section></div>`;
  }

  function paceAvailable(items) {
    return items.some(runner => {
      const card = object(runner.racecard);
      if (card.pace_style) return true;
      return records(runner.p4?.ledger).some(item => String(item.component || "").toLowerCase().includes("pace") && (number(item.value) !== null || number(item.contribution) !== null));
    });
  }

  function simulationPosition(runner, mode, all) {
    return runtime.simulationPosition(runner, mode, all, state.simulation.playing);
  }

  function renderSimulation(raceId) {
    const race = races().find(item => String(item.race_id) === String(raceId)) || races()[0];
    if (!race) return emptyState("Simulation unavailable", "No analysed race exists in this snapshot.");
    const items = runnersForRace(race.race_id);
    if (!items.length) return `<div class="stack">${raceHeader(race, "simulation")}${emptyState("Simulation unavailable", "No P4 runner analysis is available for this race.")}</div>`;
    const hasPace = paceAvailable(items);
    if (state.simulation.mode === "pace" && !hasPace) state.simulation.mode = "finish";
    const trackHeight = Math.max(560, 260 + items.length * 42);
    const lanes = items.map((runner, index) => {
      const position = simulationPosition(runner, state.simulation.mode, items);
      const top = 31 + index * (54 / Math.max(1, items.length - 1));
      return `<button class="sim-runner ${state.simulation.playing ? "" : "paused"}" style="--pos:${position.toFixed(2)}%;--speed:${state.simulation.speed};top:${top.toFixed(2)}%" data-runner="${attr(runner.horse_id)}" aria-label="Inspect ${attr(runner.horse)}"><span class="sim-horse" aria-hidden="true">♞</span><span class="sim-label"><span class="sim-rank">${esc(text(runner.p4?.model_rank, index + 1))}</span>${esc(text(runner.horse))}</span></button>`;
    }).join("");
    const active = name => state.simulation.mode === name ? "active" : "";
    return `<div class="stack">${raceHeader(race, "simulation")}<section class="panel simulation"><div class="sim-controls"><div><strong>Model visualisation</strong><span class="subline">Deterministic from the authoritative snapshot; not a physical race prediction</span></div><div class="panel-actions"><div class="segmented" aria-label="Simulation view"><button class="sim-mode ${active("finish")}" data-mode="finish">Predicted finish</button><button class="sim-mode ${active("score")}" data-mode="score">Model score</button><button class="sim-mode ${active("odds")}" data-mode="odds">Model probability</button><button class="sim-mode ${active("pace")}" data-mode="pace" ${hasPace ? "" : "disabled"}>Pace</button></div><button class="btn sim-play">${state.simulation.playing ? "Pause" : "Play"}</button><div class="segmented" aria-label="Simulation speed">${[1,2,4].map(speed => `<button class="sim-speed ${state.simulation.speed === speed ? "active" : ""}" data-speed="${speed}">${speed}×</button>`).join("")}</div></div></div><div class="sim-scroll"><div class="sim-track" style="height:${trackHeight}px"><div class="track-scenery" aria-hidden="true"></div>${lanes}</div></div><div class="sim-note">${hasPace ? "Pace mode uses genuine runner pace evidence when selected." : "Pace evidence is unavailable for this snapshot, so Pace mode is disabled."} Reduced-motion preferences are respected.</div></section></div>`;
  }

  function renderRaces() {
    const items = races().slice().sort((a, b) => `${a.course}${a.off_time_local}`.localeCompare(`${b.course}${b.off_time_local}`));
    if (!items.length) return emptyState("No racecards", "No analysed races are present for this date.");
    const rows = items.map(race => `<tr><td><strong>${esc(text(race.off_time_local))}</strong></td><td>${esc(text(race.course))}</td><td><a class="horse-name" href="#race/${attr(race.race_id)}">${esc(text(race.race_name))}</a>${race.block_reason ? `<span class="subline">${esc(race.block_reason)}</span>` : ""}</td><td>${esc(text(race.distance, distanceLabel(race.distance_yards)))}</td><td>${esc(goingLabel(race))}</td><td>${esc(text(race.runner_count))}</td><td><span class="status-chip ${String(race.p4_status).toUpperCase() === "BLOCKED" ? "failed" : stateClass(race.lifecycle)}">${esc(text(race.p4_status, "NOT ANALYSED"))}</span><span class="subline">${esc(text(race.lifecycle).replaceAll("_", " "))}</span></td><td><a class="btn" href="#race/${attr(race.race_id)}">Open</a></td></tr>`).join("");
    return panel(`Races — ${racingDateLabel()}`, `<div class="table-wrap"><table class="data-table"><thead><tr><th>Time</th><th>Course</th><th>Race</th><th>Distance</th><th>Going</th><th>Field</th><th>P4 / race status</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`, { subtitle: `${items.length} discovered racecards; blocked and unanalysed races remain visible` });
  }

  function runnerMatrix(title, source, subtitle) {
    const rows = source.map((runner, index) => {
      const card = object(runner.racecard);
      const p4 = object(runner.p4);
      const bookmaker = object(runner.bookmaker_quote);
      const betfair = object(runner.betfair_win_quote);
      const support = object(runner.supporting_models);
      const decision = object(runner.decision_trace?.outcome);
      const watch = object(runner.watch_evidence);
      const rowStatus = runner.identity_status || decision.status || "UNAVAILABLE";
      return `<tr data-horse="${attr(String(runner.horse || "").toLowerCase())}" data-course="${attr(runner.course)}" data-time="${attr(runner.off_time_local)}" data-rank="${attr(p4.model_rank ?? 999)}" data-probability="${attr(p4.win_probability ?? -1)}" data-score="${attr(p4.composite_score ?? -1)}"><td><span class="silk" style="--silk:${silkColour(index)}">${esc(text(card.number, text(card.draw, index + 1)))}</span><a class="horse-name" href="#race/${attr(runner.race_id)}">${esc(text(runner.horse))}</a></td><td>${esc(text(runner.off_time_local))}</td><td>${esc(text(runner.course))}</td><td>${esc(formatNumber(bookmaker.decimal_odds))}<span class="subline">${esc(text(bookmaker.bookmaker_name, "Unavailable"))}</span></td><td>${esc(formatNumber(betfair.best_back))}<span class="subline">Lay ${esc(formatNumber(betfair.best_lay))}</span></td><td>${esc(formatNumber(p4.model_odds))}</td><td>${esc(formatNumber(p4.raw_odds))}</td><td>${esc(formatPercent(p4.win_probability))}</td><td>${esc(formatPercent(p4.place_probability))}</td><td><span class="rank-box">${esc(text(p4.model_rank, "—"))}</span></td><td>${esc(formatNumber(p4.composite_score))}</td><td>${esc(formatNumber(object(support.classic_elo).pre_race_rating, 0))}</td><td>${esc(formatPercent(number(object(support.p5).p5_place4_prob)))}</td><td>${esc(text(object(support.qve).agreement_count))}</td><td>${esc(rowStatus.replaceAll("_", " "))}${watch.trainer_value ? `<span class="subline">${esc(watch.contract)}: ${esc(watch.trainer_value)} matches ${esc(watch.matched_text)} · WATCH ONLY</span>` : ""}${runner.availability_reason ? `<span class="subline">${esc(runner.availability_reason)}</span>` : ""}</td></tr>`;
    }).join("");
    const content = rows ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Horse</th><th>Time</th><th>Course</th><th>Bookmaker</th><th>Betfair WIN</th><th>Model</th><th>Raw</th><th>P4 win</th><th>Place</th><th>Rank</th><th>Composite</th><th>Classic ELO</th><th>P5</th><th>QVE</th><th>Decision</th></tr></thead><tbody id="runner-matrix-body">${rows}</tbody></table></div>` : emptyState("No runner analysis", "No authoritative runner rows are available in this snapshot.");
    return `<section class="panel"><header class="panel-head"><div><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div></header><div class="filter-bar"><div class="field"><label for="runner-search">Search horse</label><input id="runner-search" type="search" placeholder="Horse name"></div><div class="field"><label for="course-filter">Course</label><select id="course-filter"><option value="">All courses</option>${[...new Set(source.map(item => text(item.course)))].sort().map(course => `<option>${esc(course)}</option>`).join("")}</select></div><div class="field"><label for="runner-sort">Sort by</label><select id="runner-sort"><option value="horse">Horse A–Z</option><option value="time">Race time</option><option value="rank">Model rank</option><option value="probability">P4 probability</option><option value="score">Composite Score</option></select></div></div><div id="runner-matrix">${content}</div></section>`;
  }

  function renderResults() {
    const items = records(state.artifacts.results?.items);
    if (!items.length) return panel("Results", emptyState("Results unavailable", "No result observations are present in this snapshot. Results are never inferred in the browser."), { subtitle: "Backend result and settlement truth only" });
    const rows = items.map(item => {
      const obs = object(item.observation || parseObject(item.observation_json));
      const race = races().find(candidate => candidate.race_id === item.race_id);
      return `<tr><td>${esc(text(race?.off_time_local))}</td><td>${esc(text(race?.course))}</td><td>${esc(text(obs.horse || item.horse_id))}</td><td>${esc(text(obs.finishing_position, "—"))}</td><td>${esc(text(obs.finish_status))}</td><td>${esc(resultState(item))}</td><td>${esc(text(item.completeness).replaceAll("_", " "))}</td><td>${esc(formatDateTime(item.observed_at_utc))}</td></tr>`;
    }).join("");
    return panel("Results", `<div class="table-wrap"><table class="data-table"><thead><tr><th>Time</th><th>Course</th><th>Horse</th><th>Pos</th><th>Finish</th><th>State</th><th>Completeness</th><th>Observed</th></tr></thead><tbody>${rows}</tbody></table></div>`, { subtitle: "Canonical result observations" });
  }

  function renderWatch(kind) {
    const artifact = state.artifacts[kind];
    const label = kind === "tony" ? "Tony Watch" : "Revival Watch";
    if (!artifact || artifact.availability === "NOT_AVAILABLE") return unavailable(label, `${label} has no authoritative V2 read model yet. No signal has been fabricated for presentation.`);
    const items = records(artifact.items);
    if (kind === "tony" && artifact.availability === "NO_QUALIFIERS") return panel(label, emptyState("No Tony Watch qualifiers", "The backend V1 trainer match found no qualifier in the analysed, identified runners."), { subtitle: "WATCH ONLY · no P4 or Phase 8A effect" });
    const evidence = kind === "tony" ? "Trainer match is supplied by the backend; WATCH ONLY and does not alter P4 or Phase 8A." : artifact.reason || "Authoritative backend observations";
    return runnerMatrix(label, items, evidence);
  }

  function renderForecast() {
    return unavailable("Forecast / Tricast", state.artifacts.forecast?.reason || "No backend-generated forecast or tricast combinations are available in this read model. Results are not turned into combinations in the browser.");
  }

  function flattenHealth(value, prefix = "") {
    const rows = [];
    Object.entries(object(value)).forEach(([key, item]) => {
      const current = object(item);
      const name = prefix ? `${prefix} / ${key}` : key;
      if (current.status || current.message || current.warnings || current.errors) rows.push({ name, ...current });
      else if (Object.keys(current).length) rows.push(...flattenHealth(current, name));
    });
    return rows;
  }

  function renderHealth() {
    const rows = flattenHealth(state.artifacts.health?.health);
    const errors = Object.entries(state.errors);
    const body = `<div class="health-list">${rows.map(item => {
      const status = item.status || (list(item.errors).length ? "FAILED" : list(item.warnings).length ? "DEGRADED" : "HEALTHY");
      return `<div class="health-row"><span class="health-dot ${stateClass(status)}"></span><span>${esc(item.name.replaceAll("_", " "))}<small class="subline">${esc(text(item.message || list(item.warnings)[0] || list(item.errors)[0], "No reported issue"))}</small></span><strong class="${stateClass(status)}">${esc(text(status).replaceAll("_", " "))}</strong></div>`;
    }).join("")}${errors.map(([key, error]) => `<div class="health-row"><span class="health-dot failed"></span><span>${esc(FILES[key])}<small class="subline">${esc(error)}</small></span><strong class="failed">Unavailable</strong></div>`).join("")}</div>`;
    return `<div class="page-grid">${panel("System Health", body || emptyState("Health unavailable", "No health artifact is available."), { subtitle: "Provider absence remains distinct from core failure" })}<aside class="stack">${panel("Safety state", `<div class="health-list"><div class="health-row"><span class="health-dot healthy"></span><span>Phase 8A</span><strong>Authoritative</strong></div><div class="health-row"><span class="health-dot degraded"></span><span>Phase 8B replacements</span><strong>Inactive</strong></div><div class="health-row"><span class="health-dot ${state.artifacts.live?.summary?.activated ? "healthy" : "degraded"}"></span><span>Live backtest</span><strong>${state.artifacts.live?.summary?.activated ? "Active" : "Inactive"}</strong></div><div class="health-row"><span class="health-dot degraded"></span><span>Real wagering</span><strong>Off</strong></div><div class="health-row"><span class="health-dot degraded"></span><span>Automatic publication</span><strong>Off</strong></div></div>`)}${panel("Snapshot", `<p><strong>${esc(state.date)}</strong></p><p>${esc(formatDateTime(state.artifacts.health?.generated_at_utc))}</p><p>${esc(text(state.artifacts.health?.cycle_id))}</p>`)}</aside></div>`;
  }

  const BETS_KEY = "racing-codex-v2:my-bets:v1";
  function myBets() {
    try { const value = JSON.parse(localStorage.getItem(BETS_KEY) || "[]"); return Array.isArray(value) ? value : []; }
    catch (_error) { return []; }
  }
  function storeBets(items) { localStorage.setItem(BETS_KEY, JSON.stringify(items)); }
  function renderMyBets() {
    const items = myBets();
    const rows = items.map(item => `<tr><td>${esc(formatDateTime(item.added_at))}</td><td>${esc(text(item.race))}</td><td class="horse-name">${esc(text(item.horse))}</td><td>${betBadge(item.bet_type)}</td><td>${esc(formatNumber(number(item.stake)))}</td><td>${esc(formatNumber(number(item.price)))}</td><td>${esc(text(item.result, "Pending"))}</td><td><button class="btn remove-bet" data-id="${attr(item.id)}">Remove</button></td></tr>`).join("");
    const table = rows ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Added</th><th>Race</th><th>Horse</th><th>Bet type</th><th>Stake</th><th>Price</th><th>Result</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : emptyState("No personal bets", "Add an admitted model selection or enter a manual personal bet below.");
    const form = `<form id="manual-bet" class="filter-bar"><div class="field"><label for="bet-race">Race</label><input id="bet-race" name="race" required></div><div class="field"><label for="bet-horse">Horse</label><input id="bet-horse" name="horse" required></div><div class="field"><label for="bet-type">Bet type</label><select id="bet-type" name="bet_type"><option>WIN</option><option>EACH_WAY</option><option>LAY</option></select></div><div class="field"><label for="bet-stake">Stake</label><input id="bet-stake" name="stake" type="number" min="0.01" step="0.01" required></div><div class="field"><label for="bet-price">Price</label><input id="bet-price" name="price" type="number" min="1.01" step="0.01" required></div><button class="btn primary" type="submit">Add personal bet</button></form>`;
    return panel("My Bets", `${table}${form}<div class="notice warning"><strong>Browser-only personal record</strong><p>Stored in localStorage on this device. It is not synced, backed up, settled automatically, or included in official V2 Live Backtest metrics.</p></div>`, { subtitle: "Personal bets — isolated from the official model ledger" });
  }

  function renderBestBets() {
    return `<div class="stack">${panel(`Best Bets — ${racingDateLabel()}`, adviceRows(records(state.artifacts.best?.items)), { subtitle: "Only backend ADMITTED Phase 8A selections" })}<section class="panel accent-orange"><header class="panel-head"><div><h2>Close Calls</h2><p>Authoritative near-miss observations</p></div></header>${adviceRows(records(state.artifacts.close?.items), "close")}</section><section class="panel accent-blue"><header class="panel-head"><div><h2>Was Value</h2><p>Immutable original advice retained</p></div></header>${adviceRows(records(state.artifacts.value?.items), "value")}</section></div>`;
  }

  function renderRankOverlay() {
    const items = records(state.artifacts.rank?.items);
    const rows = items.map(item => {
      const overlay = object(item.rank_overlay);
      return `<tr><td>${esc(text(item.off_time_local))}</td><td>${esc(text(item.course))}</td><td><a class="horse-name" href="#race/${attr(item.race_id)}">${esc(text(item.horse))}</a></td><td>${esc(formatNumber(object(item.bookmaker_quote).decimal_odds))}</td><td>${esc(text(overlay.market_rank, "—"))}</td><td>${esc(formatNumber(object(item.p4).model_odds))}</td><td>${esc(text(overlay.model_rank, "—"))}</td><td><strong class="positive">+${esc(text(overlay.rank_improvement, "—"))}</strong></td></tr>`;
    }).join("");
    const main = panel("Rank Overlay", rows ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Time</th><th>Course</th><th>Horse</th><th>Sky Bet Odds</th><th>Market Rank</th><th>Model Odds</th><th>Model Rank</th><th>Rank Improvement</th></tr></thead><tbody>${rows}</tbody></table></div>` : emptyState("No +5 overlays", "No runner improved by at least five positions from the Sky Bet market ladder to the Model Odds ladder."), { subtitle: text(state.artifacts.rank?.selection_contract, "Sky Bet market rank minus Model Odds rank ≥ 5") });
    return main;
  }

  function renderTopRatedClear() {
    const items = records(state.artifacts.clear?.items);
    if (!items.length) return panel("Top Rated Clear", emptyState("No Top Rated Clear qualifiers", "No runner was marked qualified by the authoritative backend informational route."), { subtitle: "Informational only · never a Best Bet by itself" });
    const rows = items.map(item => {
      const clear = object(item.top_rated_clear);
      const p4 = object(item.p4);
      const candidate = records(clear.checks).filter(check => check.status === "PASS").slice(0, 3).map(check => text(check.name)).join(" · ");
      return `<tr><td>${esc(text(item.off_time_local))}</td><td>${esc(text(item.course))}</td><td><a href="#race/${attr(item.race_id)}">${esc(text(item.horse))}</a></td><td>#${esc(text(p4.model_rank, "—"))}</td><td>${esc(formatNumber(p4.composite_score))}</td><td>${esc(candidate || "Backend qualified")}</td><td><span class="tag neutral">WATCH · NOT A BET</span></td></tr>`;
    }).join("");
    return panel("Top Rated Clear", `<div class="table-wrap"><table class="data-table"><thead><tr><th>Time</th><th>Course</th><th>Horse</th><th>P4 rank</th><th>Composite</th><th>Backend evidence</th><th>Meaning</th></tr></thead><tbody>${rows}</tbody></table></div>`, { subtitle: "Only backend-qualified informational route output; no browser threshold" });
  }

  function renderElo() {
    const items = records(state.artifacts.elo?.items);
    const rows = items.map(item => {
      const standout = object(item.elo_standout);
      const classic = object(item.supporting_models?.classic_elo);
      const weightMargin = object(item.supporting_models?.weight_margin_elo);
      return `<tr><td>${esc(text(item.off_time_local))}</td><td>${esc(text(item.course))}</td><td><a class="horse-name" href="#race/${attr(item.race_id)}">${esc(text(item.horse))}</a></td><td>${esc(formatNumber(classic.pre_race_rating, 0))}</td><td>${esc(text(standout.classic_elo_rank, classic.rank ?? "—"))}</td><td>${esc(formatNumber(classic.last_change, 1))}</td><td>${esc(formatNumber(standout.gap_to_next, 1))}</td><td>${esc(formatNumber(standout.gap_to_race_median, 1))}</td><td>${esc(formatNumber(weightMargin.pre_race_rating, 0))}<span class="subline">rank #${esc(text(weightMargin.rank, "—"))}</span></td></tr>`;
    }).join("");
    return panel("Classic ELO Standouts", rows ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Time</th><th>Course</th><th>Horse</th><th>Classic Rating</th><th>Race Rank</th><th>Last Change</th><th>Gap to Next</th><th>Gap to Median</th><th>W+M Shadow</th></tr></thead><tbody>${rows}</tbody></table></div>` : emptyState("No Classic ELO standouts", "No runner met the documented race-relative Classic ELO standout contract."), { subtitle: text(state.artifacts.elo?.selection_contract, "Classic ELO race-relative threshold") });
  }

  function render() {
    const current = route();
    const navRoute = ["race", "simulation", "races"].includes(current.name) ? "racecards" : current.name;
    setActiveNav(navRoute);
    document.querySelectorAll(".race-link").forEach(link => link.classList.toggle("active", decodeURIComponent(link.hash.split("/").slice(1).join("/")) === current.id));
    if (Object.keys(state.artifacts).length === 0) {
      app.innerHTML = `<div class="notice error"><h1>Snapshot unavailable</h1><p>No Phase 10 static artifact could be loaded for ${esc(state.date)}.</p><p>${esc(Object.values(state.errors)[0] || "Check the preview data path.")}</p></div>`;
      return;
    }
    const views = {
      home: renderHome,
      "best-bets": renderBestBets,
      "close-calls": renderCloseCalls,
      "was-value": renderWasValue,
      "live-backtest": renderLiveBacktest,
      racecards: renderRaces,
      races: renderRaces,
      results: renderResults,
      runners: () => runnerMatrix("A–Z All Runners", runners(), "Every analysed runner in the selected snapshot"),
      elo: renderElo,
      "rank-overlay": renderRankOverlay,
      "top-rated-clear": renderTopRatedClear,
      forecast: renderForecast,
      "tony-watch": () => renderWatch("tony"),
      "revival-watch": () => renderWatch("revival"),
      health: renderHealth,
      research: renderResearch,
      "my-bets": renderMyBets,
      race: () => renderRace(current.id),
      simulation: () => renderSimulation(current.id)
    };
    const view = views[current.name] || renderHome;
    app.innerHTML = view();
    document.title = `${current.name === "home" ? "Racing Command Centre" : current.name.replaceAll("-", " ")} · Racing Codex V2`;
    app.querySelector("h1, h2")?.setAttribute("tabindex", "-1");
    bindViewEvents();
  }

  function applyRunnerFilters() {
    const body = document.querySelector("#runner-matrix-body");
    if (!body) return;
    const search = String(document.querySelector("#runner-search")?.value || "").trim().toLowerCase();
    const course = String(document.querySelector("#course-filter")?.value || "");
    const sort = String(document.querySelector("#runner-sort")?.value || "horse");
    const rows = [...body.querySelectorAll("tr")];
    rows.forEach(row => { row.hidden = Boolean((search && !row.dataset.horse.includes(search)) || (course && row.dataset.course !== course)); });
    const compare = {
      horse: (a, b) => a.dataset.horse.localeCompare(b.dataset.horse),
      time: (a, b) => a.dataset.time.localeCompare(b.dataset.time),
      rank: (a, b) => Number(a.dataset.rank) - Number(b.dataset.rank),
      probability: (a, b) => Number(b.dataset.probability) - Number(a.dataset.probability),
      score: (a, b) => Number(b.dataset.score) - Number(a.dataset.score)
    }[sort];
    rows.sort(compare).forEach(row => body.appendChild(row));
  }

  function bindViewEvents() {
    document.querySelector("#runner-search")?.addEventListener("input", applyRunnerFilters);
    document.querySelector("#course-filter")?.addEventListener("change", applyRunnerFilters);
    document.querySelector("#runner-sort")?.addEventListener("change", applyRunnerFilters);
    document.querySelectorAll(".sim-mode").forEach(button => button.addEventListener("click", () => { state.simulation.mode = button.dataset.mode; render(); }));
    document.querySelector(".sim-play")?.addEventListener("click", () => { state.simulation.playing = !state.simulation.playing; render(); });
    document.querySelectorAll(".sim-speed").forEach(button => button.addEventListener("click", () => { state.simulation.speed = Number(button.dataset.speed); render(); }));
    document.querySelectorAll(".sim-runner").forEach(button => button.addEventListener("click", () => {
      const runner = runners().find(item => String(item.horse_id) === String(button.dataset.runner));
      if (runner) location.hash = `#race/${encodeURIComponent(runner.race_id)}`;
    }));
    document.querySelectorAll(".add-bet").forEach(button => button.addEventListener("click", () => addAdviceBet(button)));
    document.querySelectorAll(".remove-bet").forEach(button => button.addEventListener("click", () => {
      storeBets(myBets().filter(item => item.id !== button.dataset.id));
      render();
    }));
    document.querySelector("#manual-bet")?.addEventListener("submit", event => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const stake = Number(data.get("stake")); const price = Number(data.get("price"));
      if (!(stake > 0 && price > 1)) return;
      const items = myBets();
      items.push({ id: crypto.randomUUID(), added_at: new Date().toISOString(), race: String(data.get("race")), horse: String(data.get("horse")), bet_type: String(data.get("bet_type")), stake, price, result: "Pending", source: "MANUAL" });
      storeBets(items); render();
    });
  }

  function addAdviceBet(button) {
    const stake = Number(window.prompt("Stake for this personal bet", "1.00"));
    const suggested = button.dataset.price || "";
    const price = Number(window.prompt("Price taken", suggested));
    if (!(stake > 0 && price > 1)) return;
    const race = races().find(item => String(item.race_id) === String(button.dataset.race));
    const items = myBets();
    items.push({ id: crypto.randomUUID(), added_at: new Date().toISOString(), race: `${race?.off_time_local || ""} ${race?.course || button.dataset.race}`.trim(), race_id: button.dataset.race, horse_id: button.dataset.horse, horse: button.dataset.name, bet_type: button.dataset.type, stake, price, result: "Pending", advice_id: button.dataset.advice || null, source: "MODEL_SELECTION" });
    storeBets(items); location.hash = "#my-bets";
  }

  menuButton.addEventListener("click", () => {
    const open = nav.classList.toggle("open");
    menuButton.setAttribute("aria-expanded", String(open));
  });
  dateInput.addEventListener("change", () => {
    if (!runtime.validRacingDate(dateInput.value)) return;
    state.date = dateInput.value;
    const params = new URLSearchParams(location.search); params.set("date", state.date);
    history.replaceState(null, "", `${location.pathname}?${params}${location.hash}`);
    loadSnapshot();
  });
  window.addEventListener("hashchange", render);
  reducedMotion.addEventListener("change", event => { if (event.matches) state.simulation.playing = false; render(); });
  loadSnapshot();
})();
