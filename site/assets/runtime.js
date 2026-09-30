(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.RacingCodexRuntime = api;
})(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";

  function escapeHTML(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function finite(value, fallback) {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
  }

  function simulationPosition(runner, mode, allRunners, playing) {
    if (!playing) return 7;
    const runners = Array.isArray(allRunners) ? allRunners : [];
    const p4 = runner && typeof runner.p4 === "object" ? runner.p4 : {};
    if (mode === "finish") {
      const rank = Math.max(1, finite(p4.model_rank, runners.length || 1));
      return 88 - ((rank - 1) / Math.max(1, runners.length - 1)) * 63;
    }
    const field = mode === "score" ? "composite_score" : "win_probability";
    const values = runners.map(item => finite(item?.p4?.[field], 0));
    const value = finite(p4[field], 0);
    const minimum = Math.min(...values);
    const maximum = Math.max(...values);
    return 22 + ((value - minimum) / Math.max(.000001, maximum - minimum)) * 66;
  }

  function validRacingDate(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
  }

  function raceResultLabel(observation, completeness) {
    const item = observation && typeof observation === "object" ? observation : {};
    if (item.non_runner) return "NR";
    if (String(item.finish_status || "").toUpperCase() === "VOID") return "Void";
    if (item.winner) return Number(item.dead_heat_divisor) > 1 ? "Won · Dead Heat" : "Won";
    if (item.placed) return Number(item.place_dead_heat_divisor) > 1 ? "Placed · Dead Heat" : "Placed";
    if (item.finishing_position) return `Finished ${item.finishing_position}`;
    return String(item.official_result_status || completeness || "Result pending").replaceAll("_", " ");
  }

  function settlementLabel(settlement) {
    const item = settlement && typeof settlement === "object" ? settlement : {};
    const status = String(item.status || "").toUpperCase();
    if (!status || status === "PENDING" || status === "EVIDENCE_INSUFFICIENT") return "Pending";
    if (status === "VOID") return "Void";
    if (item.winning_selection === true) return "Won";
    if (item.placed_selection === true) return "Placed";
    if (status === "SETTLED") return "Lost";
    return status.replaceAll("_", " ");
  }

  return Object.freeze({ escapeHTML, raceResultLabel, settlementLabel, simulationPosition, validRacingDate });
});
