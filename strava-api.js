#!/usr/bin/env node

require("dotenv").config();

const fp = require("find-free-port");
const fs = require("fs");
const http = require("http");
const url = require("url");
const error = require("./error");

const { Strava } = require("strava");

const {
  STRAVA_REFRESH_TOKEN: stravaRefreshToken,
  STRAVA_CLIENT_ID: stravaClientId,
  STRAVA_CLIENT_SECRET: stravaClientSecret,
} = process.env;

const AUTH_CACHE_FILE = "strava-auth.json";

/**
 * read cache from disk
 */
function loadCache() {
  try {
    const jsonStr = fs.readFileSync(AUTH_CACHE_FILE, "utf8");
    if (!jsonStr?.trim().length) return;
    return /** @type {import("strava").Strava} */ JSON.parse(jsonStr);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

async function getStrava() {
  const cache = loadCache();

  const saveToken = (/** @type {import('strava').AccessToken} */ cache) =>
    fs.writeFileSync(AUTH_CACHE_FILE, JSON.stringify(cache));

  if (cache || stravaRefreshToken) {
    return new Strava(
      {
        client_id: stravaClientId,
        client_secret: stravaClientSecret,
        refresh_token: stravaRefreshToken,

        on_token_refresh: saveToken,
      },
      cache
    );
  } else {
    const tokenExchangeCode = await getTokenExchangeCodeFromBrowser();
    return await Strava.createFromTokenExchange(
      {
        client_id: stravaClientId,
        client_secret: stravaClientSecret,
        on_token_refresh: saveToken,
      },
      tokenExchangeCode
    );
  }
}

/** @return {Promise<string>} */
async function getTokenExchangeCodeFromBrowser() {
  const [port] = await fp(10000);

  return new Promise((resolve) => {
    let server = http.createServer(async (request, response) => {
      const respond = (httpCode, message) => {
        response.writeHead(httpCode, { "Content-Type": "text/plain" });
        response.write(message);
        response.end();
      };

      const requestUrl = url.parse(request.url, { parseQueryString: true });
      if (requestUrl.pathname !== "/strava-token") {
        if (requestUrl.pathname !== "/favicon.ico") {
          console.debug(`Ignoring request to ${requestUrl.pathname}`);
        }
      } else if (requestUrl.query.error == "access_denied") {
        respond(400, "Permission denied, click back to try again");
      } else if (requestUrl.query.error) {
        respond(500, "Unexpected error from Strava: " + requestUrl.query.error);
      } else {
        respond(200, "Complete, you may now close this window");
        server.close();
        resolve(requestUrl.query.code);
      }
    });
    server.listen({ port });
    console.error("To authorize this script, please visit:");
    console.error(
      `http://www.strava.com/oauth/authorize?client_id=${stravaClientId}&response_type=code&redirect_uri=http://localhost:${port}/strava-token&approval_prompt=auto&scope=read_all,profile:read_all,activity:read_all`
    );
  });
}

async function main() {
  if (!stravaClientId || !stravaClientSecret) {
    error(
      "The environment variables have not been provided, please see the README."
    );
  }
  const tokenExchangeCode = await getTokenExchangeCodeFromBrowser();
  const refreshToken = await new Promise((resolve, reject) =>
    Strava.createFromTokenExchange(
      {
        client_id: stravaClientId,
        client_secret: stravaClientSecret,
        on_token_refresh: resolve,
      },
      tokenExchangeCode
    ).catch(reject)
  );
  console.log("Refresh token:", refreshToken);
}

if (module.parent) {
  module.exports = { getStrava };
} else {
  main().catch(error);
}
