/* Rendering and device-local notes only. All racing decisions/results are captured. */
(function (root) {
  "use strict";
  const KEY = "racing-codex-v2:my-bets:v1";
  const sections = [
    ["v2_best_bets", "v2", "V2 BEST BETS", "Official selections · retained for the whole racing day."],
    ["original_model", "original", "ORIGINAL MODEL BEST BETS", "Separate comparison · excluded from official V2 performance."],
    ["close_calls", "close", "CLOSE CALLS", "NOT A BET · candidates that did not qualify."],
    ["was_value", "value", "WAS VALUE EARLIER TODAY", "Earlier official selections · original prices and terms retained."]
  ];
  const rowKeys = ["time", "course", "horse", "real_odds", "model_odds", "raw_odds", "bookmaker", "bet_type", "route", "places", "fraction", "status", "result", "notice", "tags", "official_settlement"];
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
  const num = value => typeof value === "number" && Number.isFinite(value) ? value.toFixed(2) : "—";
  const ukDay = now => new Intl.DateTimeFormat("en-CA", {timeZone:"Europe/London",year:"numeric",month:"2-digit",day:"2-digit"}).format(now);
  const ownKeys = (obj, keys) => obj && typeof obj === "object" && !Array.isArray(obj) && Object.keys(obj).sort().join("|") === [...keys].sort().join("|");
  function valid(data, now = new Date()) {
    if (!ownKeys(data, ["schema_version","racing_date","generated_at_utc","synthetic","original_model_available",...sections.map(s=>s[0])]) || data.schema_version !== 1 || typeof data.synthetic !== "boolean" || typeof data.original_model_available !== "boolean") return false;
    const stamp = new Date(data.generated_at_utc);
    if (!Number.isFinite(stamp.getTime()) || !/^\d{4}-\d{2}-\d{2}$/.test(data.racing_date)) return false;
    if (!data.synthetic && (data.racing_date !== ukDay(now) || now - stamp < 0)) return false;
    return sections.every(([key]) => Array.isArray(data[key]) && data[key].length <= 2000 && data[key].every(row => {
      if (!ownKeys(row,rowKeys)) return false;
      if (!["time","course","horse","bet_type","route","status","result","notice"].every(k=>typeof row[k]==="string" && row[k].length<=180)) return false;
      if (!["real_odds","model_odds","raw_odds","places","fraction"].every(k=>row[k]===null || typeof row[k]==="number" && Number.isFinite(row[k]))) return false;
      if (!Array.isArray(row.tags) || !row.tags.every(x=>typeof x==="string")) return false;
      const money = row.official_settlement;
      return money === null || ["v2_best_bets","was_value"].includes(key) && ownKeys(money,["status","stake","returns","profit_loss"]) && ["SETTLED","VOID"].includes(money.status) && ["stake","returns","profit_loss"].every(k=>typeof money[k]==="number" && Number.isFinite(money[k]));
    }));
  }
  function bets(storage) {
    try { const value = JSON.parse(storage.getItem(KEY) || "[]"); return Array.isArray(value) ? value : []; } catch { return []; }
  }
  const keyFor = (day,section,row) => "public:" + JSON.stringify([day,section,row.time,row.course,row.horse,row.route]);
  function add(storage, day, section, row, stake, price, clock = new Date()) {
    if (!(Number.isFinite(stake) && stake>0 && Number.isFinite(price) && price>1)) return false;
    const sourceKey = keyFor(day,section,row), items = bets(storage);
    if (items.some(item=>item.source_key === sourceKey)) return false;
    items.push({id:root.crypto.randomUUID(),added_at:clock.toISOString(),race:`${row.time} ${row.course}`,race_id:"",horse_id:"",horse:row.horse,bet_type:row.bet_type,stake,price,result:"Pending",advice_id:null,source:section==="original_model"?"ORIGINAL_MODEL":section==="close_calls"?"CLOSE_CALL":section==="was_value"?"WAS_VALUE":"MODEL_SELECTION",source_key:sourceKey});
    storage.setItem(KEY,JSON.stringify(items)); return true;
  }
  function render(data, storage, now = new Date()) {
    if (!valid(data,now)) return '<p class="notice">Today’s snapshot is unavailable, out of date or invalid. No selections are shown.</p>';
    const personal = bets(storage);
    const stale=!data.synthetic && now-new Date(data.generated_at_utc)>1800000;
    return (stale?'<p class="notice">Older snapshot · daily history only. Prices are original captures, not current quotes.</p>':'') + sections.map(([key,id,title,note]) => `<section id="${id}" class="${id}"><h2>${title}</h2><p class="section-note">${note}</p>${data[key].length ? data[key].map((row,index)=>{
      const money=row.official_settlement;
      const added=personal.some(item=>item.source_key===keyFor(data.racing_date,key,row));
      const terms=row.bet_type==="EACH_WAY" ? `${row.places===null?"Places not captured":`${row.places} places`}${row.fraction===null?" · fraction not captured":` · ${esc(({0.2:"1/5",0.25:"1/4"})[row.fraction] || row.fraction)} odds fraction`}` : "";
      return `<article class="card"><div class="selection"><div class="race"><strong>${esc(row.time)}</strong><small>${esc(row.course)}</small></div><div class="horse"><span class="label">${esc(row.notice)}</span><strong>${esc(row.horse)}</strong></div><div class="prices">${[["Real",row.real_odds,"real"],["Model",row.model_odds,"model"],["Raw",row.raw_odds,"raw"]].map(([label,value,style])=>`<div class="${style}"><small>${label}</small><strong>${num(value)}</strong></div>`).join("")}</div><div class="bet"><strong>${esc(row.bet_type.replaceAll("_"," "))}</strong><small>${terms}</small></div></div><div class="footer-row"><div class="outcome"><strong>${esc(row.result)}</strong>${money?`<small>Official stake ${num(money.stake)} · Return ${num(money.returns)} · P/L ${num(money.profit_loss)}</small>`:""}</div><button data-section="${key}" data-index="${index}" ${added?"disabled":""}>${added?"✓ My Bets":"+ My Bets"}</button></div><details><summary>Why?</summary><p>Captured route: ${esc(row.route)}${row.bookmaker?` · ${esc(row.bookmaker)}`:""}. ${row.tags.map(esc).join(" · ")}</p><p>${key==="close_calls"?"Did not qualify; this is not an official bet.":key==="was_value"?"Qualified earlier; this section does not imply current qualification.":key==="original_model"?"Original Model comparison only. Top Finish results are separate from bookmaker E/W settlement.":"Admitted by the model at the original captured price. This is a daily record, not a live quote."}</p></details></article>`;
    }).join("") : `<p class="empty">${key==="original_model" && !data.original_model_available?"Original Model comparison unavailable today.":"No selections in this section today."}</p>`}</section>`).join("");
  }
  const api=Object.freeze({valid,render,add,bets,keyFor});
  if (typeof module === "object" && module.exports) { module.exports=api; return; }
  const cards=document.getElementById("cards"), snapshot=document.getElementById("snapshot"), notice=document.getElementById("notice");
  let data=null;
  function display() {
    cards.innerHTML=render(data,localStorage);
    const okay=valid(data);
    snapshot.textContent=okay?`${data.racing_date} · Captured ${new Date(data.generated_at_utc).toLocaleString("en-GB",{timeZone:"Europe/London"})} UK`:"Current racing day unavailable";
    notice.innerHTML=okay && data.synthetic?'<p class="notice">SYNTHETIC PREVIEW — these are fictional examples, not live selections.</p>':"";
    document.getElementById("personal-items").innerHTML=bets(localStorage).filter(x=>String(x.source_key||"").startsWith("public:")).map(x=>`<div class="personal-row"><strong>${esc(x.horse)}</strong> · ${esc(x.race)} · ${esc(x.bet_type)} · Personal stake ${num(x.stake)} at ${num(x.price)}</div>`).join("") || '<p class="empty">No personal notes added from this page.</p>';
  }
  cards.addEventListener("click",event=>{
    const button=event.target.closest("button[data-section]");
    if (!button || !valid(data)) return;
    const row=data[button.dataset.section]?.[Number(button.dataset.index)];
    if (!row) return;
    const stake=Number(root.prompt("Personal stake", "1.00")), price=Number(root.prompt("Your price taken",row.real_odds===null || !["WIN","EACH_WAY"].includes(row.bet_type)?"":String(row.real_odds)));
    try { if (add(localStorage,data.racing_date,button.dataset.section,row,stake,price)) display(); }
    catch { document.getElementById("personal-status").textContent="This browser could not save the personal note."; }
  });
  fetch("data/best-bets.json",{cache:"no-store"}).then(response=>{if(!response.ok)throw Error();return response.json();}).then(value=>{data=value;display();}).catch(()=>display());
  setInterval(display,60000); // Time guard only; no repeated fetch or server writes.
})(typeof globalThis === "object" ? globalThis : this);
