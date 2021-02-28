#!/usr/bin/env node

require("dotenv").config();
const fetch = require("node-fetch");
const fp = require("find-free-port");
const fs = require("fs");
const http = require("http");
const url = require("url");
const error = require("./error");

const {
  STRAVA_REFRESH_TOKEN: stravaRefreshToken,
  STRAVA_CLIENT_ID: stravaClientId,
  STRAVA_CLIENT_SECRET: stravaClientSecret,
} = process.env;

const cache = {
  /** @type {string} */ stravaRefreshToken: stravaRefreshToken,
  /** @type {string} */ stravaAccessToken: undefined,
};

const AUTH_CACHE_FILE = "strava-auth.json";

/**
 * read cache from disk
 */
function loadCache() {
  try {
    const jsonStr = fs.readFileSync(AUTH_CACHE_FILE);
    Object.assign(cache, JSON.parse(jsonStr));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

/**
 * Updates cached strava authentication tokens if necessary
 */
async function getStravaToken(tokens = undefined) {
  if (!tokens && cache.stravaAccessToken) return cache.stravaAccessToken;

  loadCache();

  // get new tokens
  const res = await fetch("https://www.strava.com/oauth/token", {
    method: "post",
    body: JSON.stringify({
      grant_type: "refresh_token",
      client_id: stravaClientId,
      client_secret: stravaClientSecret,
      ...(tokens || { refresh_token: cache.stravaRefreshToken }),
    }),
    headers: { "Content-Type": "application/json" },
  });
  if (res.status >= 400 && tokens) {
    console.error("/token:", res.status, "body:", await res.json());
    process.exit(1);
  }
  const data = await res.json();
  cache.stravaAccessToken = data.access_token;
  cache.stravaRefreshToken = data.refresh_token;

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
    headers: { Authorization: `Bearer ${await getStravaToken()}` },
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

async function getAccessTokenFromBrowser() {
  const [port] = await fp(10000);
  return new Promise((resolve) => {
    let server = http.createServer(async (request, response) => {
      const requestUrl = url.parse(request.url, { parseQueryString: true });
      if (requestUrl.pathname !== "/strava-token") {
        if (requestUrl.pathname !== "/favicon.ico") {
          console.debug(`Ignoring request to ${requestUrl.pathname}`);
        }
        return;
      }
      response.writeHead(200, { "Content-Type": "text/plain" });
      response.write("Complete, you may now close this window");
      response.end();
      server.close();
      await getStravaToken({
        code: requestUrl.query.code,
        grant_type: "authorization_code",
      });
      resolve();
    });
    server.listen({ port });
    console.error("To authorize this script, please visit:");
    console.error(
      `http://www.strava.com/oauth/authorize?client_id=${stravaClientId}&response_type=code&redirect_uri=http://localhost:${port}/strava-token&approval_prompt=auto&scope=read_all,profile:read_all,activity:read_all`
    );
  });
}

async function main() {
  if (!stravaClientId || !stravaClientSecret)
    error(
      "The environment variables have not been provided, please see the README."
    );
  await getAccessTokenFromBrowser();
  console.log("Refresh token:", cache.stravaRefreshToken);
}

if (module.parent) {
  module.exports = { stravaAPI };
} else {
  main().catch(error);
}
