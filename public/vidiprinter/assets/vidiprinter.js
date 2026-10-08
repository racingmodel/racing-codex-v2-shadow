"use strict";
(() => {
  const kinds = {"NEW WIN":"new-win", "NEW E/W":"new-ew", "UPDATED":"updated",
    "WAS VALUE":"was-value", "RESULT":"result", "NR":"nr", "VOID":"void", "CLOSE CALL":"close-call",
    "V1 NEW WIN":"v1-new-win", "V1 NEW E/W":"v1-new-ew"};
  const fields = ["event_id", "raised_at_utc", "event", "race_time", "course", "horse", "odds_or_result"];
  const envelope = ["schema_version", "racing_date", "generated_at_utc", "published_at_utc", "events"];
  const list = document.querySelector("#events");
  const status = document.querySelector("#status");
  const uk = {timeZone:"Europe/London"};
  const time = new Intl.DateTimeFormat("en-GB", {...uk, hour:"2-digit", minute:"2-digit"});
  const ukDate = new Intl.DateTimeFormat("en-GB", {...uk, year:"numeric", month:"2-digit", day:"2-digit"});
  const dayMonth = new Intl.DateTimeFormat("en-GB", {...uk, day:"2-digit", month:"short"});
  const stamp = new Intl.DateTimeFormat("en-GB", {...uk, dateStyle:"short", timeStyle:"short"});
  function formatRaisedAt(value, racingDate) {
    const date = new Date(value);
    const parts = Object.fromEntries(ukDate.formatToParts(date).map(part => [part.type,part.value]));
    if (`${parts.year}-${parts.month}-${parts.day}` === racingDate) return time.format(date);
    return `${dayMonth.format(date)} ${time.format(date)}`;
  }
  function exact(value, keys) {
    return value && typeof value === "object" && !Array.isArray(value)
      && Object.keys(value).sort().join("|") === [...keys].sort().join("|");
  }
  function cell(name, value) {
    const el = document.createElement("span"); el.className = name; el.textContent = value; return el;
  }
  async function load() {
    try {
      // A fresh request URL on every viewer reload avoids browser/CDN cached JSON.
      const response = await fetch(`data/vidiprinter.json?refresh=${Date.now()}`, {cache:"no-store"});
      if (!response.ok) throw new Error("unavailable");
      const feed = await response.json();
      if (!exact(feed, envelope) || feed.schema_version !== 1 || !/^\d{4}-\d{2}-\d{2}$/.test(feed.racing_date)
          || !Number.isFinite(Date.parse(feed.generated_at_utc))
          || !Number.isFinite(Date.parse(feed.published_at_utc)) || !Array.isArray(feed.events)) throw new Error("invalid");
      const ids = new Set();
      for (const row of feed.events) {
        if (!exact(row, fields) || !Object.hasOwn(kinds, row.event)
            || !/^[0-9a-f-]{36}$/.test(row.event_id) || ids.has(row.event_id)
            || !Number.isFinite(Date.parse(row.raised_at_utc))
            || !fields.every(key => typeof row[key] === "string")) throw new Error("invalid");
        ids.add(row.event_id);
      }
      const rows = [...feed.events].sort((a,b) => b.raised_at_utc.localeCompare(a.raised_at_utc)
        || b.event_id.localeCompare(a.event_id));
      const fragment = document.createDocumentFragment();
      for (const item of rows) {
        const row = document.createElement("li"); row.className = "event-row";
        row.dataset.eventId = item.event_id;
        const raised = cell("raised", formatRaisedAt(item.raised_at_utc, feed.racing_date)); raised.title = item.raised_at_utc;
        const kind = cell("kind", ""); kind.append(cell(`badge ${kinds[item.event]}`, item.event));
        if (item.event === "CLOSE CALL") kind.append(cell("not-a-bet", "NOT A BET"));
        row.append(raised,kind,cell("race-time",item.race_time),cell("course",item.course),
          cell("horse",item.horse),cell("value",item.odds_or_result));
        fragment.append(row);
      }
      list.replaceChildren(fragment);
      document.querySelector("#racing-day").textContent = `Racing day: ${feed.racing_date}`;
      document.querySelector("#empty").hidden = rows.length !== 0;
      status.textContent = `${rows.length} captured events · snapshot ${stamp.format(new Date(feed.generated_at_utc))} UK · last published ${stamp.format(new Date(feed.published_at_utc))} UK`;
    } catch (_) {
      list.replaceChildren();
      status.textContent = "Published feed unavailable — refresh to try again.";
    }
  }
  load();
})();
