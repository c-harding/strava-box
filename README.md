<p align="center">
  <img width="400" src="https://i.imgur.com/oVlFAGG.png">
  <h3 align="center">strava-box</h3>
  <p align="center">Update a gist to contain your YTD Strava distances</p>
</p>

---

## Previous Work

This repo is based off of [matchai's waka-box](https://github.com/matchai/waka-box).

## Setup

### Prep work

1. Create a new public GitHub Gist (<https://gist.github.com/>)
2. Create a GitHub token with the `gist` scope and copy it. (<https://github.com/settings/tokens/new>)
3. Create a Strava Application (<https://www.strava.com/settings/api>)
   - Copy the `Client ID` and `Client Secret`.
4. Get your `Athlete Token` by going to <https://www.strava.com>, click your profile photo in the top right corner. Copy the ID in the url. `https://www.strava.com/athletes/`**`12345`**

### Project setup

1. Fork this repo
2. Get the *refresh token*:
   1. Clone this repo locally
   2. Make a copy of `sample.env` called `.env`, and add all the tokens/IDs requested (see environment variables section below), excluding the refresh token.
   3. Run `npm install` to install the necessary dependencies to run the project.
   4. Run `./strava-api.js`, open the link provided, and click to authorize the app.
   5. The refresh token will be printed to your terminal.
3. Log into CircleCI with your GitHub (<https://circleci.com/vcs-authorize/>)
4. Click on "Add Projects" on the sidebar
5. Set up a project with the newly created fork
6. Go to Project Settings > Environment Variables
7. Add the following environment variables:

### Environment variables

When completing a DOTENV file, do not include any spaces or quotes around the codes.
E.g. `STRAVA_CLIENT_ID=12345`

- **GIST_ID:** The ID portion from your gist url `https://gist.github.com/<github username>/`**`6d5f84419863089a167387da62dd7081`**.
- **GITHUB_TOKEN:** The GitHub token generated above.
- **STRAVA_ATHLETE_ID:** The ID you got from visiting your profile page.
- **STRAVA_CLIENT_ID:** The client ID you got from the Strava API page.
- **STRAVA_CLIENT_SECRET:** The client secret you got from the Strava API page.
- **STRAVA_REFRESH_TOKEN:** The token from Project Setup, step 2.
- (optional) **UNITS:** `miles`, `km`, `metres` or `meters`
