#!/usr/bin/env node

require("dotenv").config();
const { DateTime } = require("luxon");
const error = require("./error");
const { getStrava } = require("./strava-api");

const { UNITS: units } = process.env;

async function main(steps = false, startDate = undefined) {
  const stats = await getFullStravaStats(steps, startDate);
  const output = await Promise.all(stats.map((stat) => stat.prepareOutput()));
  return steps ? output : output[0] ?? "";
}

class Summary {
  constructor({ stats, year } = {}) {
    this.year = year || NaN;
    this.stats = Object.assign({}, stats) || {};
  }
  add(type, activityTime, activityDistance, date) {
    this.date = date;
    if (date.year !== this.year) this.stats = {};
    this.year = date.year;
    const { count = 0, time = 0, distance = 0 } = this.stats[type] || {};
    this.stats[type] = {
      count: count + 1,
      time: time + activityTime,
      distance: distance + activityDistance,
    };
    return this;
  }
  getTotalTime() {
    return Object.values(this.stats).reduce((a, b) => a + b.time, 0);
  }
  getActivities() {
    return Object.entries(this.stats).map(([type, sums]) => ({
      type,
      ...sums,
    }));
  }

  async prepareOutput() {
    const totalTime = this.getTotalTime();

    // Store the activity name and distance
    const activities = this.getActivities()
      .sort((a, b) => b.count - a.count)
      .slice(0, 3)
      .map((activity) => ({
        ...activity,
        percent: (activity.time / totalTime) * 100,
      }));

    // Format the data to be displayed in the Gist
    return Object.assign(
      formatTable(activities, [
        { key: "type", transform: renameType },
        { key: "distance", align: "right", transform: formatDistance },
        { key: "time", transform: formatTime },
        {
          key: "percent",
          transform: (percent) => generateBarChart(percent, 28),
        },
        // { key: "percent", align: "right", transform: formatPercentage },
      ]),
      { date: this.date }
    );
  }
}

class Summaries {
  constructor(steps = false) {
    this.steps = !!steps;
    this.summaries = [];
  }

  getSummary() {
    return this.summaries[this.summaries.length - 1];
  }
  getSummaries() {
    return this.summaries;
  }

  updateSummary(f) {
    if (this.steps) this.summaries.push(f(this.getSummary()));
    else this.summaries = [f(this.getSummary())];
  }

  push(type, time, distance, date) {
    this.updateSummary((summary) =>
      new Summary(summary).add(type, time, distance, date)
    );
  }
}

/**
 * Fetches your data from the Strava API
 * The distance returned by the API is in meters
 */
async function getFullStravaStats(
  steps = false,
  /** @type {DateTime?} */ startDate = undefined
) {
  const strava = await getStrava();
  const summaries = new Summaries(steps);
  let page;
  let i = 1;
  let after = (startDate || DateTime.now()).startOf("year").toSeconds();
  do {
    page = await strava.activities.getLoggedInAthleteActivities({
      after,
      per_page: 200,
      page: i++,
    });
    for (const {
      distance,
      moving_time: time,
      elapsed_time: duration,
      type: rawType,
      start_date: activityStart,
    } of page) {
      const type = groupType(rawType);
      const endDate = DateTime.fromISO(activityStart).plus({
        seconds: duration,
      });
      summaries.push(type, time, distance, endDate);
    }
  } while (page.length);

  return summaries.getSummaries();
}

function formatTable(rows, columns, sep = "  ") {
  const widths = columns.map(
    ({ width, value, key, transform = (x) => x }) =>
      width ||
      (value && value.length) ||
      Math.max(...rows.map((row) => `${transform(row[key])}`.length))
  );
  return rows
    .map((row) =>
      columns
        .map(({ width, value, key, align, transform = (x) => x }, i) => {
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
  const syms = " ▏▎▍▌▋▊▉█";

  const frac = Math.floor((size * 8 * percent) / 100);
  const barsFull = Math.floor(frac / 8);
  if (barsFull >= size) {
    return syms[8].repeat(size);
  }
  const semi = frac % 8;

  return [syms[8].repeat(barsFull), syms.substring(semi, semi + 1)]
    .join("")
    .padEnd(size, syms.substring(0, 1));
}

function groupType(type) {
  if (/ski$/i.test(type)) return "Ski";
  if (/^virtual/i.test(type)) return type.replace(/^virtual/i, "");
  return (
    {
      Walk: "Hike",
      Snowshoe: "Hike",
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
    case "km":
    case "kilometers":
    case "kilometres":
      return `${metersToKilometers(distance)} km`;
    case "miles":
      return `${metersToMiles(distance)} mi`;
    case "metres":
    case "meters":
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
    ["w", Infinity],
  ];
  const times = [];
  let carry = time;
  for (const [symbol, divisor] of timePeriods) {
    times.push((carry % divisor) + symbol);
    carry = Math.floor(carry / divisor);
    if (!carry) break;
  }
  return times.slice(-2).reverse().join(" ");
}

function metersToMiles(meters) {
  const CONVERSION_CONSTANT = 0.000621371192;
  return (meters * CONVERSION_CONSTANT).toFixed(1);
}

function metersToKilometers(meters) {
  const CONVERSION_CONSTANT = 1000;
  return (meters / CONVERSION_CONSTANT).toFixed(1);
}

if (module.parent) {
  module.exports = main;
} else {
  (async () => {
    try {
      console.log((await main()).toString());
    } catch (e) {
      error(
        "Fatal error:",
        e,
        ...(e?.json ? ["with response body", await e?.json?.()] : [])
      );
    }
  })();
}
