#!/usr/bin/env node

require("dotenv").config();
const getStats = require("./stats");
const error = require("./error");
const fs = require("fs").promises;
const path = require("path");
const shell = require("shelljs");
const { DateTime } = require("luxon");

if (!shell.which("git")) error("git not found");

const filename = "YTD Strava Stats";

async function main(dir) {
  if (!dir) error("No path to gist repository given");
  try {
    let stat = await fs.lstat(dir);
    if (!stat.isDirectory()) error("Invalid path to gist repository");
  } catch (e) {
    error("Invalid path to gist repository");
  }

  const startDate = DateTime.fromISO("2017-01-01T00:00:00Z");
  const stats = await getStats(true, startDate);
  shell.cd(path.resolve(dir));
  for (const stat of stats) {
    await fs.writeFile(filename, stat.toString());
    shell.exec(`git add "${filename}"`);
    shell.exec(
      `GIT_AUTHOR_DATE="${stat.date.toISO()}" git commit --allow-empty-message -m ''`
    );
  }
}

(async () => {
  try {
    await main(...process.argv.slice(2));
  } catch (e) {
    error(e);
  }
})();
