/* CTTLFA admin — Fixture Analytics context layers (2022-2026).
   Static reference data overlaid on the fixture analytics: South African public
   holidays, the Islamic calendar (Ramadan + the two Eids), Western Cape school
   holidays, Cape Town rainfall (disruptive days), and load-shedding intensity.
   Exposes window.FA_CTX. Sources and caveats are recorded in FA_CTX.meta and
   surfaced on the Context tab. */
(function () {
  "use strict";

  /* ---- SA public holidays 2022-2026 (observed dates, incl. Monday-in-lieu
     and the once-off 2024 election day). Source: Public Holidays Act 36 of 1994. ---- */
  var hol = {
    "2022-01-01": "New Year's Day", "2022-03-21": "Human Rights Day", "2022-04-15": "Good Friday",
    "2022-04-18": "Family Day", "2022-04-27": "Freedom Day", "2022-05-02": "Workers' Day (observed)",
    "2022-06-16": "Youth Day", "2022-08-09": "National Women's Day", "2022-09-24": "Heritage Day",
    "2022-12-16": "Day of Reconciliation", "2022-12-26": "Day of Goodwill", "2022-12-27": "Christmas Day (observed)",
    "2023-01-02": "New Year's Day (observed)", "2023-03-21": "Human Rights Day", "2023-04-07": "Good Friday",
    "2023-04-10": "Family Day", "2023-04-27": "Freedom Day", "2023-05-01": "Workers' Day",
    "2023-06-16": "Youth Day", "2023-08-09": "National Women's Day", "2023-09-25": "Heritage Day (observed)",
    "2023-12-16": "Day of Reconciliation", "2023-12-25": "Christmas Day", "2023-12-26": "Day of Goodwill",
    "2024-01-01": "New Year's Day", "2024-03-21": "Human Rights Day", "2024-03-29": "Good Friday",
    "2024-04-01": "Family Day", "2024-04-27": "Freedom Day", "2024-05-01": "Workers' Day",
    "2024-05-29": "National and Provincial Elections", "2024-06-17": "Youth Day (observed)",
    "2024-08-09": "National Women's Day", "2024-09-24": "Heritage Day", "2024-12-16": "Day of Reconciliation",
    "2024-12-25": "Christmas Day", "2024-12-26": "Day of Goodwill",
    "2025-01-01": "New Year's Day", "2025-03-21": "Human Rights Day", "2025-04-18": "Good Friday",
    "2025-04-21": "Family Day", "2025-04-28": "Freedom Day (observed)", "2025-05-01": "Workers' Day",
    "2025-06-16": "Youth Day", "2025-08-09": "National Women's Day", "2025-09-24": "Heritage Day",
    "2025-12-16": "Day of Reconciliation", "2025-12-25": "Christmas Day", "2025-12-26": "Day of Goodwill",
    "2026-01-01": "New Year's Day", "2026-03-21": "Human Rights Day", "2026-04-03": "Good Friday",
    "2026-04-06": "Family Day", "2026-04-27": "Freedom Day", "2026-05-01": "Workers' Day",
    "2026-06-16": "Youth Day", "2026-08-10": "National Women's Day (observed)", "2026-09-24": "Heritage Day",
    "2026-12-16": "Day of Reconciliation", "2026-12-25": "Christmas Day", "2026-12-26": "Day of Goodwill"
  };

  /* ---- Islamic calendar 2022-2026 (South African observance, ±1 day on the
     moon sighting). Ramadan window [start,end]; Eids as single days. ---- */
  var ramadan = [
    { y: 2022, s: "2022-04-03", e: "2022-05-02" }, { y: 2023, s: "2023-03-23", e: "2023-04-21" },
    { y: 2024, s: "2024-03-11", e: "2024-04-10" }, { y: 2025, s: "2025-03-01", e: "2025-03-30" },
    { y: 2026, s: "2026-02-18", e: "2026-03-19" }
  ];
  var eid = {
    "2022-05-03": "Eid al-Fitr", "2022-07-09": "Eid al-Adha", "2023-04-22": "Eid al-Fitr", "2023-06-28": "Eid al-Adha",
    "2024-04-11": "Eid al-Fitr", "2024-06-16": "Eid al-Adha", "2025-03-31": "Eid al-Fitr", "2025-06-06": "Eid al-Adha",
    "2026-03-20": "Eid al-Fitr", "2026-05-27": "Eid al-Adha"
  };

  /* ---- Western Cape school holidays 2022-2026 (in-season breaks). Approximate
     band edges from the WCED / DBE school calendar. ---- */
  var school = [
    { y: 2022, s: "2022-03-26", e: "2022-04-04", name: "Autumn break" }, { y: 2022, s: "2022-06-25", e: "2022-07-18", name: "Winter break" }, { y: 2022, s: "2022-10-01", e: "2022-10-10", name: "Spring break" },
    { y: 2023, s: "2023-04-01", e: "2023-04-10", name: "Autumn break" }, { y: 2023, s: "2023-06-24", e: "2023-07-17", name: "Winter break" }, { y: 2023, s: "2023-09-30", e: "2023-10-09", name: "Spring break" },
    { y: 2024, s: "2024-03-21", e: "2024-04-02", name: "Autumn break" }, { y: 2024, s: "2024-06-15", e: "2024-07-08", name: "Winter break" }, { y: 2024, s: "2024-09-21", e: "2024-09-30", name: "Spring break" },
    { y: 2025, s: "2025-03-29", e: "2025-04-07", name: "Autumn break" }, { y: 2025, s: "2025-06-28", e: "2025-07-21", name: "Winter break" }, { y: 2025, s: "2025-10-04", e: "2025-10-12", name: "Spring break" },
    { y: 2026, s: "2026-03-28", e: "2026-04-07", name: "Autumn break" }, { y: 2026, s: "2026-06-27", e: "2026-07-20", name: "Winter break" }, { y: 2026, s: "2026-09-24", e: "2026-10-05", name: "Spring break" }
  ];

  /* ---- Load-shedding intensity by month, 0 (none) to 4 (severe). Indicative
     national stage intensity; the City of Cape Town typically ran about one
     stage lower. Source: CSIR utility statistics and public record. ---- */
  var ls = {
    "2022-01": 1, "2022-02": 1, "2022-03": 1, "2022-04": 2, "2022-05": 2, "2022-06": 3, "2022-07": 2, "2022-08": 2, "2022-09": 4, "2022-10": 2, "2022-11": 3, "2022-12": 3,
    "2023-01": 3, "2023-02": 3, "2023-03": 3, "2023-04": 3, "2023-05": 3, "2023-06": 4, "2023-07": 4, "2023-08": 4, "2023-09": 4, "2023-10": 3, "2023-11": 3, "2023-12": 3,
    "2024-01": 3, "2024-02": 3, "2024-03": 2, "2024-04": 0, "2024-05": 0, "2024-06": 0, "2024-07": 0, "2024-08": 0, "2024-09": 0, "2024-10": 0, "2024-11": 0, "2024-12": 0,
    "2025-01": 1, "2025-02": 1, "2025-03": 0, "2025-04": 0, "2025-05": 0, "2025-06": 0, "2025-07": 0, "2025-08": 0, "2025-09": 0, "2025-10": 0, "2025-11": 0, "2025-12": 0,
    "2026-01": 0, "2026-02": 0, "2026-03": 0, "2026-04": 0, "2026-05": 0, "2026-06": 0, "2026-07": 0, "2026-08": 0, "2026-09": 0, "2026-10": 0
  };

  /* ---- Cape Town disruptive rainfall: days with 5 mm or more, in-season
     (Apr-Sep). {iso: mm}. Source: Xweather (Vaisala), point -33.926,18.423,
     extracted 17 Sep 2026. A single point as a proxy for greater Cape Town. ---- */
  var rain = {
    "2022-05-06": 8.1, "2022-05-28": 6.4, "2022-05-29": 12.2, "2022-06-13": 38.6, "2022-06-14": 22.9, "2022-06-18": 22.1, "2022-06-23": 24.2, "2022-07-02": 7.4, "2022-07-03": 5.1, "2022-07-29": 7.2, "2022-08-12": 15.4, "2022-08-13": 5.7, "2022-08-17": 13.4, "2022-08-18": 5.3, "2022-09-04": 7.6,
    "2023-04-20": 8.7, "2023-04-22": 5.9, "2023-04-23": 17.6, "2023-04-24": 7.0, "2023-05-25": 26.3, "2023-05-29": 12.1, "2023-05-30": 17.0, "2023-06-03": 7.4, "2023-06-04": 5.7, "2023-06-07": 9.6, "2023-06-08": 5.7, "2023-06-11": 8.8, "2023-06-14": 17.9, "2023-06-15": 17.7, "2023-06-17": 18.0, "2023-06-19": 7.1, "2023-06-29": 5.3, "2023-07-08": 6.1, "2023-07-28": 7.5, "2023-08-17": 9.0, "2023-08-21": 6.2, "2023-08-22": 7.6, "2023-08-25": 5.3, "2023-09-24": 16.4, "2023-09-25": 25.0,
    "2024-04-08": 25.4, "2024-05-10": 7.4, "2024-05-30": 6.0, "2024-06-05": 13.5, "2024-06-06": 10.1, "2024-06-18": 11.5, "2024-06-21": 9.9, "2024-07-03": 22.0, "2024-07-07": 31.9, "2024-07-08": 10.8, "2024-07-09": 27.8, "2024-07-10": 8.7, "2024-07-11": 25.9, "2024-07-13": 18.9, "2024-07-14": 8.2, "2024-07-16": 5.5, "2024-07-18": 17.0, "2024-07-19": 9.2, "2024-07-27": 12.4, "2024-08-04": 12.0, "2024-08-08": 13.6, "2024-08-10": 19.9, "2024-08-13": 14.5, "2024-08-21": 6.2, "2024-08-26": 6.7, "2024-08-27": 8.5, "2024-09-28": 12.2,
    "2025-04-08": 39.0, "2025-05-10": 17.5, "2025-05-20": 17.1, "2025-06-07": 29.0, "2025-06-20": 5.8, "2025-06-25": 28.6, "2025-06-26": 13.4, "2025-06-27": 7.1, "2025-06-28": 14.8, "2025-07-03": 36.9, "2025-07-04": 19.5, "2025-07-05": 10.3, "2025-07-06": 7.3, "2025-07-17": 14.3, "2025-07-30": 16.4, "2025-08-04": 17.6, "2025-08-09": 15.8,
    "2026-04-03": 17.8, "2026-04-17": 24.8, "2026-04-19": 20.8, "2026-04-26": 16.0, "2026-05-04": 18.3, "2026-05-10": 31.6, "2026-05-11": 45.6, "2026-05-12": 17.6, "2026-06-11": 5.4, "2026-06-23": 9.2, "2026-06-28": 25.6, "2026-07-23": 7.5, "2026-08-06": 13.1, "2026-09-14": 13.1, "2026-09-15": 15.1, "2026-09-16": 5.1
  };

  window.FA_CTX = {
    hol: hol, ramadan: ramadan, eid: eid, school: school, ls: ls, rain: rain,
    meta: {
      extracted: "2026-09-17",
      rainNote: "Cape Town rainfall is a single-point reading (Xweather, Vaisala) standing in for venues across greater Cape Town; a wet flag is indicative, not venue-specific. Days of 5 mm or more, in-season.",
      lsNote: "Load-shedding is indicative national stage intensity by month (CSIR / public record); the City of Cape Town typically ran about one stage lower, and this is not a per-suburb schedule.",
      schoolNote: "School-holiday bands are approximate WCED / DBE term-calendar edges.",
      islamNote: "Islamic dates follow South African observance and can shift by a day on the moon sighting.",
      lsCaveat: "Load-shedding and severe weather bit hardest in 2022 and 2023 and had largely fallen away by 2025."
    }
  };
})();
