#!/usr/bin/env node

require("dotenv").config();
const Octokit = require("@octokit/rest");
const fetch = require("node-fetch");

const {
  STRAVA_ATHLETE_ID: stravaAtheleteId,
  STRAVA_ACCESS_TOKEN: stravaAccessToken,
  UNITS: units
} = process.env;

const isNode = typeof module !== "undefined";
const isMain = isNode && !module.parent;

function error(...message) {
  console.error(...message);
  process.exit(1);
}

async function main() {
  const stats = await yearToDate();
  return await prepareOutput(stats);
}

async function stravaAPI(endpoint, query = {}) {
  const API_BASE = "https://www.strava.com/api/v3";
  const queryString = Object.entries(query)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  const API = `${API_BASE}${endpoint}?${queryString}`;

  const data = await fetch(API, {
    headers: { Authorization: `Bearer ${stravaAccessToken}` }
  });
  const json = await data.json();

  return json;
}

/**
 * Fetches your data from the Strava API
 * The distance returned by the API is in meters
 */
async function getStravaStats() {
  const stats = await stravaAPI(`/athletes/${stravaAtheleteId}/stats`);
  const keyMappings = {
    Run: {
      key: "ytd_run_totals"
    },
    Swim: {
      key: "ytd_swim_totals"
    },
    Ride: {
      key: "ytd_ride_totals"
    }
  };

  return Object.entries(keyMappings).map(([type, { key }]) => {
    const { distance, moving_time: time, count } = stats[key];

    return { type, count, distance, time };
  });
}

/**
 * Fetches your data from the Strava API
 * The distance returned by the API is in meters
 */
async function getFullStravaStats() {
  const getPage = async i =>
    stravaAPI(`/athlete/activities`, {
      after: new Date(new Date().getFullYear(), 0, 1) / 1000,
      per_page: 200,
      page: i
    });

  const summary = {};
  let page,
    i = 1;
  do {
    page = await getPage(i++);
    for (const { distance, moving_time: time, type: rawType } of page) {
      const type = groupType(rawType);
      const typeSummary = summary[type] || (summary[type] = {});
      typeSummary.count = 1 + (typeSummary.count || 0);
      typeSummary.time = time + (typeSummary.time || 0);
      typeSummary.distance = distance + (typeSummary.distance || 0);
    }
  } while (page.length);

  return Object.entries(summary).map(([type, sums]) => ({ type, ...sums }));
}

async function yearToDate() {
  const stats = await getFullStravaStats();
  let totalTime = Object.values(stats).reduce((a, b) => a + b.time, 0);

  // Store the activity name and distance
  return stats
    .sort((a, b) => b.count - a.count)
    .slice(0, 3)
    .map(activity => ({
      ...activity,
      percent: (activity.time / totalTime) * 100
    }));
}

async function prepareOutput(activities) {
  // Format the data to be displayed in the Gist
  return formatTable(activities, [
    { key: "type", transform: renameType },
    { key: "distance", align: "right", transform: formatDistance },
    { key: "time", transform: formatTime },
    { key: "percent", transform: percent => generateBarChart(percent, 28) }
    // { key: "percent", align: "right", transform: formatPercentage },
  ]);
}

function formatTable(rows, columns, sep = "  ") {
  const widths = columns.map(
    ({ width, value, key, transform = x => x }) =>
      width ||
      (value && value.length) ||
      Math.max(...rows.map(row => `${transform(row[key])}`.length))
  );
  return rows
    .map(row =>
      columns
        .map(({ width, value, key, align, transform = x => x }, i) => {
          value = transform(value || row[key], i);
          const alignRight = align && align[0].toLowerCase() === "r";
          if (width) value = value.substr(width * (alignRight ? -1 : 1), width);
          return `${value}`[alignRight ? "padStart" : "padEnd"](widths[i]);
        })
        .join(sep)
    )
    .join("\n");
}

function generateBarChart(percent, size) {
  const empty = "░";
  const full = "█";
  const barsFull = Math.round(size * (percent / 100));
  return full.repeat(barsFull).padEnd(size, empty);
}

function groupType(type) {
  if (/ski$/i.test(type)) return "Ski";
  if (/^virtual/i.test(type)) return test.replace(/^virtual/i, "");
  return (
    {
      Walk: "Hike",
      Snowshoe: "Hike"
    }[type] || type
  );
}

function renameType(type) {
  if (type === "EBikeRide") return "E-biking";
  if (/Ride$/.test(type)) type = type.replace("Ride", "Cycle");
  type = type.replace(
    /([a-z])([A-Z])/g,
    (x, a, b) => `${a} ${b.toLowerCase()}`
  );
  if (/(ski|surf|board|sail|walk|shoe)$/i.test(type)) return `${type}ing`;
  if (/(skate|ride|cycle|hike)$/i.test(type)) return type.replace(/.$/i, "ing");
  if (/(swim|run)$/i.test(type)) return type.replace(/(.)$/i, "$1$1ing");
  return type;
}

function formatDistance(distance) {
  const trimmedDistance = parseFloat(distance).toFixed(2);
  switch (units) {
    case "meters":
      return `${trimmedDistance} m`;
    case "km":
      return `${metersToKilometers(distance)} km`;
    case "miles":
      return `${metersToMiles(distance)} mi`;
    default:
      return `${trimmedDistance} m`;
  }
}

function formatTime(time) {
  const timePeriods = [
    ["s", 60],
    ["m", 60],
    ["h", 24],
    ["d", 7],
    ["w", Infinity]
  ];
  const times = [];
  let carry = time;
  for ([symbol, divisor] of timePeriods) {
    times.push((carry % divisor) + symbol);
    carry = Math.floor(carry / divisor);
    if (!carry) break;
  }
  return times
    .slice(-2)
    .reverse()
    .join(" ");
}

function metersToMiles(meters) {
  const CONVERSION_CONSTANT = 0.000621371192;
  return (meters * CONVERSION_CONSTANT).toFixed(1);
}

function metersToKilometers(meters) {
  const CONVERSION_CONSTANT = 1000;
  return (meters / CONVERSION_CONSTANT).toFixed(1);
}

if (isMain)
  (async () => {
    try {
      console.log(await main());
    } catch (e) {
      error(e);
    }
  })();
else if (isNode) module.exports = main;
