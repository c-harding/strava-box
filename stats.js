#!/usr/bin/env node

require("dotenv").config();
const http = require("http");
const fetch = require("node-fetch");
const fs = require("fs");
const url = require("url");
const fp = require("find-free-port");
const moment = require("moment");
const error = require("./error");

const {
  UNITS: units,
  STRAVA_REFRESH_TOKEN: stravaRefreshToken,
  STRAVA_CLIENT_ID: stravaClientId,
  STRAVA_CLIENT_SECRET: stravaClientSecret
} = process.env;

const AUTH_CACHE_FILE = "strava-auth.json";

const isNode = typeof module !== "undefined";
const isMain = isNode && !module.parent;

async function main(steps = false) {
  const stats = await yearToDate(steps);
  const output = await Promise.all(stats.map(stat => stat.prepareOutput()));
  return steps ? output : output[0] ?? "";
}

const cache = {
  stravaRefreshToken: stravaRefreshToken
};

/**
 * Updates cached strava authentication tokens if necessary
 */
async function getStravaToken(tokens = undefined) {
  if (!tokens && cache.stravaAccessToken) return cache.stravaAccessToken;

  // read cache from disk
  try {
    const jsonStr = fs.readFileSync(AUTH_CACHE_FILE);
    Object.assign(cache, JSON.parse(jsonStr));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  console.debug(`ref: ${cache.stravaRefreshToken?.substring(0, 6)}`);

  // get new tokens
  const res = await fetch("https://www.strava.com/oauth/token", {
    method: "post",
    body: JSON.stringify({
      grant_type: "refresh_token",
      client_id: stravaClientId,
      client_secret: stravaClientSecret,
      ...(tokens || { refresh_token: cache.stravaRefreshToken })
    }),
    headers: { "Content-Type": "application/json" }
  });
  if (res.status >= 400 && tokens) {
    console.error("/token:", res.status, "body:", await res.json());
    process.exit(1);
  }
  const data = await res.json();
  cache.stravaAccessToken = data.access_token;
  cache.stravaRefreshToken = data.refresh_token;
  console.debug(`acc: ${cache.stravaAccessToken?.substring(0, 6)}`);
  console.debug(`ref: ${cache.stravaRefreshToken?.substring(0, 6)}`);

  // save to disk
  fs.writeFileSync(AUTH_CACHE_FILE, JSON.stringify(cache));

  return cache.stravaAccessToken;
}

async function rawStravaAPI(endpoint, query = {}) {
  const API_BASE = "https://www.strava.com/api/v3";
  const queryString = Object.entries(query)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  const API = `${API_BASE}${endpoint}?${queryString}`;

  const data = await fetch(API, {
    headers: { Authorization: `Bearer ${await getStravaToken()}` }
  });
  return data;
}

async function stravaAPI(endpoint, query = {}) {
  let data = await rawStravaAPI(endpoint, query);
  if (data.status == 401) {
    await getAccessTokenFromBrowser();
    data = await rawStravaAPI(endpoint, query);
  }
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
        {
          key: "percent",
          transform: percent => generateBarChart(percent, 28)
        }
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

async function getPage(i) {
  return stravaAPI(`/athlete/activities`, {
    after: new Date(new Date().getFullYear(), 0, 1) / 1000,
    per_page: 200,
    page: i
  });
}

/**
 * Fetches your data from the Strava API
 * The distance returned by the API is in meters
 */
async function getFullStravaStats(steps = false) {
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
  const syms = " ▏▎▍▌▋▊▉█";

  const frac = Math.floor((size * 8 * percent) / 100);
  const barsFull = Math.floor(frac / 8);
  if (barsFull >= size) {
    return syms.substring(8, 9).repeat(size);
  }
  const semi = frac % 8;

  return [syms.substring(8, 9).repeat(barsFull), syms.substring(semi, semi + 1)]
    .join("")
    .padEnd(size, syms.substring(0, 1));
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

async function getAccessTokenFromBrowser() {
  const [port] = await fp(10000);
  return new Promise(async resolve => {
    let server = http.createServer(async (request, response) => {
      const requestUrl = url.parse(request.url, { parseQueryString: true });
      if (requestUrl.pathname != "/strava-token") {
        console.debug(`Ignoring request to ${requestUrl.pathname}`);
        return;
      }
      response.writeHead(200, { "Content-Type": "text/plain" });
      response.write("Complete, you may now close this window");
      response.end();
      await server.close();
      await getStravaToken({
        code: requestUrl.query.code,
        grant_type: "authorization_code"
      });
      resolve();
    });
    server.listen({ port });
    console.error(
      "Unauthorised, please visit",
      `http://www.strava.com/oauth/authorize?client_id=${stravaClientId}&response_type=code&redirect_uri=http://localhost:${port}/strava-token&approval_prompt=auto&scope=read_all,profile:read_all,activity:read_all`
    );
  });
}

if (isMain)
  (async () => {
    try {
      console.log((await main()).toString());
    } catch (e) {
      error(e);
    }
  })();
else if (isNode) module.exports = main;
