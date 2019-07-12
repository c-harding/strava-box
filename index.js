#!/usr/bin/env node

require("dotenv").config();
const getStats = require("./stats");
const Octokit = require("@octokit/rest");
const error = require("./error");

const { GIST_ID: gistId, GITHUB_TOKEN: githubToken } = process.env;

const octokit = new Octokit({
  auth: `token ${githubToken}`
});

async function main() {
  const body = await getStats();
  await updateGist(body);
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
    const filename = Object.keys(gist.data.files).sort()[0];
    if (gist.data.files[filename].content == body) return;
    await octokit.gists.update({
      gist_id: gistId,
      files: {
        [filename]: {
          content: body
        }
      }
    });
  } catch (e) {
    error("Unable to update gist", e);
  }
}

(async () => {
  try {
    await main();
  } catch (e) {
    error(e);
  }
})();
