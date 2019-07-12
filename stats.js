#!/usr/bin/env node

require("dotenv").config();
const Octokit = require("@octokit/rest");
const fetch = require("node-fetch");
const moment = require("moment");
const error = require("./error");

const { STRAVA_ACCESS_TOKEN: stravaAccessToken, UNITS: units } = process.env;

const isNode = typeof module !== "undefined";
const isMain = isNode && !module.parent;

async function main(steps) {
  const stats = await yearToDate(steps);
  const output = await Promise.all(stats.map(stat => stat.prepareOutput()));
  return steps ? output : output[0];
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

class Summary {
  constructor({ stats } = {}) {
    this.stats = Object.assign({}, stats) || {};
  }
  add(type, activityTime, activityDistance, date) {
    this.date = date;
    const { count = 0, time = 0, distance = 0 } = this.stats[type] || {};
    this.stats[type] = {
      count: count + 1,
      time: time + activityTime,
      distance: distance + activityDistance
    };
    return this;
  }
  getTotalTime() {
    return Object.values(this.stats).reduce((a, b) => a + b.time, 0);
  }
  getActivities() {
    return Object.entries(this.stats).map(([type, sums]) => ({
      type,
      ...sums
    }));
  }

  async prepareOutput() {
    const totalTime = this.getTotalTime();

    // Store the activity name and distance
    const activities = this.getActivities()
      .sort((a, b) => b.count - a.count)
      .slice(0, 3)
      .map(activity => ({
        ...activity,
        percent: (activity.time / totalTime) * 100
      }));

    // Format the data to be displayed in the Gist
    return Object.assign(
      formatTable(activities, [
        { key: "type", transform: renameType },
        { key: "distance", align: "right", transform: formatDistance },
        { key: "time", transform: formatTime },
        { key: "percent", transform: percent => generateBarChart(percent, 28) }
        // { key: "percent", align: "right", transform: formatPercentage },
      ]),
      { date: this.date }
    );
  }
}

function Summaries(steps = false) {
  steps = !!steps;
  let summaries = [];

  const getSummary = () => summaries[summaries.length - 1];
  const getSummaries = () => summaries;

  const updateSummary = f =>
    steps ? summaries.push(f(getSummary())) : (summaries = [f(getSummary())]);

  const push = (type, time, distance, date) =>
    updateSummary(summary =>
      new Summary(summary).add(type, time, distance, date)
    );

  Object.assign(this, { push, getSummary, getSummaries });
}

/**
 * Fetches your data from the Strava API
 * The distance returned by the API is in meters
 */
async function getFullStravaStats(steps = false) {
  const getPage = async i =>
    stravaAPI(`/athlete/activities`, {
      after: new Date(new Date().getFullYear(), 0, 1) / 1000,
      per_page: 200,
      page: i
    });

  const summaries = new Summaries(steps);
  let page,
    i = 1;
  do {
    page = await getPage(i++);
    for (const {
      distance,
      moving_time: time,
      elapsed_time: duration,
      type: rawType,
      start_date: startDate
    } of page) {
      const type = groupType(rawType);
      const endDate = moment(startDate).add(duration, "seconds");
      summaries.push(type, time, distance, endDate);
    }
  } while (page.length);

  return summaries.getSummaries();
}

async function yearToDate(steps = false) {
  return await getFullStravaStats(steps);
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
