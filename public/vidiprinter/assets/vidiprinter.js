"use strict";
(() => {
  const interval = 15000;
  const feedUrl = "data/vidiprinter.json";
  const kinds = {"NEW WIN":"new-win", "NEW E/W":"new-ew", "UPDATED":"updated",
    "WAS VALUE":"was-value", "RESULT":"result", "NR":"nr", "VOID":"void"};
  const eventFields = ["event_id", "raised_at_utc", "event", "race_time", "course", "horse", "odds_or_result"];
  const envelopeFields = ["schema_version", "racing_date", "generated_at_utc", "events"];
  const events = document.querySelector("#events");
  const status = document.querySelector("#status");
  const empty = document.querySelector("#empty");
  const ukTime = new Intl.DateTimeFormat("en-GB", {timeZone:"Europe/London", hour:"2-digit", minute:"2-digit"});
  let seen = new Set();
  let inFlight = false;
  function exactKeys(value, keys) {
    return value && typeof value === "object" && !Array.isArray(value)
      && Object.keys(value).sort().join("|") === [...keys].sort().join("|");
  }
  function validEvent(item) {
    return exactKeys(item, eventFields) && /^[0-9a-f-]{36}$/i.test(item.event_id)
      && Number.isFinite(Date.parse(item.raised_at_utc)) && kinds[item.event]
      && [item.race_time, item.course, item.horse, item.odds_or_result].every(x => typeof x === "string");
  }
  function cell(className, value) {
    const el = document.createElement("span"); el.className = className; el.textContent = value; return el;
  }
  async function refresh() {
    if (inFlight) return;
    inFlight = true;
    try {
      const response = await fetch(feedUrl, {cache:"no-store"});
      if (!response.ok) throw new Error("unavailable");
      const feed = await response.json();
      if (!exactKeys(feed, envelopeFields) || feed.schema_version !== 1
          || !/^\d{4}-\d{2}-\d{2}$/.test(feed.racing_date)
          || !Number.isFinite(Date.parse(feed.generated_at_utc)) || !Array.isArray(feed.events)) throw new Error("invalid");
      const unique = new Map();
      for (const item of feed.events) if (validEvent(item)) unique.set(item.event_id, item);
      const ordered = [...unique.values()].sort((a,b) => b.raised_at_utc.localeCompare(a.raised_at_utc)
        || b.event_id.localeCompare(a.event_id));
      const fragment = document.createDocumentFragment();
      for (const item of ordered) {
        const row = document.createElement("li"); row.className = "event-row";
        if (seen.size && !seen.has(item.event_id)) row.classList.add("fresh");
        row.dataset.eventId = item.event_id;
        const raised = cell("raised", ukTime.format(new Date(item.raised_at_utc)));
        raised.title = item.raised_at_utc;
        const kind = cell("kind", ""); kind.append(cell(`badge ${kinds[item.event]}`, item.event));
        row.append(raised, kind, cell("race-time", item.race_time), cell("course", item.course),
          cell("horse", item.horse), cell("value", item.odds_or_result));
        fragment.append(row);
      }
      events.replaceChildren(fragment);
      seen = new Set(unique.keys());
      empty.hidden = ordered.length !== 0;
      const day = new Date(`${feed.racing_date}T12:00:00Z`);
      const displayDay = new Intl.DateTimeFormat("en-GB", {timeZone:"Europe/London", weekday:"long", day:"numeric", month:"long", year:"numeric"}).format(day);
      document.querySelector("header p").textContent = `${displayDay} · historical captured events`;
      empty.textContent = `No captured events for ${displayDay}.`;
      status.textContent = `${ordered.length} captured events · snapshot ${ukTime.format(new Date(feed.generated_at_utc))} UK`;
    } catch (_) {
      status.textContent = "Feed unavailable · retained lines shown · retrying";
    } finally { inFlight = false; }
  }
  refresh();
  setInterval(refresh, interval);
})();
