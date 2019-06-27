#!/usr/bin/env node

require("dotenv").config();
const getStats = require("./stats");
const Octokit = require("@octokit/rest");

const {
  GIST_ID: gistId,
  GITHUB_TOKEN: githubToken,
  STRAVA_ATHLETE_ID: stravaAtheleteId,
  STRAVA_ACCESS_TOKEN: stravaAccessToken,
  UNITS: units
} = process.env;

const octokit = new Octokit({
  auth: `token ${githubToken}`
});

async function main() {
  const body = await getStats();
  await updateGist(body);
}

function error(...message) {
  console.error(...message);
  process.exit(1);
}

async function updateGist(body) {
  let gist;
  try {
    gist = await octokit.gists.get({ gist_id: gistId });
  } catch (e) {
    error("Unable to get gist", e);
  }

  try {
    // Get original filename to update that same file
    const filename = Object.keys(gist.data.files)[0];
    await octokit.gists.update({
      gist_id: gistId,
      files: {
        [filename]: {
          filename: "YTD Strava Metrics",
          content: body
        }
      }
    });
  } catch (e) {
    error("Unable to update gist", e);
  }
}

(async () => {
  await main();
})();
