# STRIKEPOINT self-hosted PvP

The game is served by a small Node.js WebSocket relay. The relay pairs two players in a room and forwards their match events; it does not store accounts or match history.

## Run locally

1. Install Node.js 18 or newer.
2. In this folder, run `npm install`.
3. Run `npm start`.
4. Open `http://localhost:8080` in two browser windows. Host a room in one and join its code in the other.

The admin menu opens with **C** and asks for the password configured in `.env`. The local configuration is set to the requested password. `.env` is excluded from Git and is never served by the web server.

## Play over the internet

Deploy this folder to a host that supports long-lived WebSocket connections, expose its HTTPS URL, and allow the `/ws` WebSocket route. Both players visit the deployed URL. Use HTTPS in production so browsers connect over secure WebSockets. Set `ADMIN_PASSWORD` in the host's private environment settings; do not upload `.env`.

`render.yaml` is a Render Blueprint for a free Node web service. Put these files in a Git repository, connect that repository to Render, and create a Blueprint from it. Enter `ADMIN_PASSWORD` as a private environment value when prompted. Then add `StrikePoint.com` and `www.StrikePoint.com` as custom domains in the Render service and apply the DNS records Render provides at your domain provider.

Render's free web services can sleep after inactivity, so their first wake-up may take about a minute. Upgrade only if you want the server to stay available continuously.

The server limits rooms to two players. Room codes are temporary and rooms disappear after both players disconnect.
