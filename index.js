#!/usr/bin/env node

require("dotenv").config();
const getStats = require("./stats");
const { Octokit } = require("@octokit/rest");
const error = require("./error");

const { GIST_ID: gistId, GIST_TOKEN: gistToken } = process.env;

const octokit = new Octokit({
  auth: `token ${gistToken}`,
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

    // If the string does not contain anything other than whitespace
    if (!/\S/.test(body)) {
      body = `No activities yet for ${new Date().getFullYear()}, showing ${
        new Date().getFullYear() - 1
      }\n`;
      body += gist.data.files[filename].content;
    }
    if (gist.data.files[filename].content == body) return;
    await octokit.gists.update({
      gist_id: gistId,
      files: {
        [filename]: {
          content: body,
        },
      },
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
