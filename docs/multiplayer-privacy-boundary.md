# Multiplayer privacy boundary

**Status:** The local online server, admin/player UI, authentication tokens, online calculation flow, and firm reports are implemented. This file describes the current boundary and outstanding production-hardening work.

## Current audiences

- **Admin:** bearer-token access to game setup, full game state, macros, roster, token rotation, and period calculation. Keep the token private and store it outside the repository.
- **Player:** a firm-scoped rejoin token grants that firm's own decision and reports. The player status response contains firm names and submission flags only; it does not return competitors' decisions or financial figures.
- **Invite holder:** the shared invitation is a bearer credential permitting creation of one firm while the lobby is open. The lobby has a 12-firm limit and closes on game start. Anyone who receives the link can use it until it is rotated or the lobby closes.
- **Tunnel provider:** with Quick Tunnel, requests are relayed through Cloudflare. This adds Cloudflare to the network trust boundary; choose it only if that is acceptable for the game data.

## Data handling

- Treat firm reports (decisions, revenue/cost/profit, inventory, cash/debt, capacity, employment, RIF, and distress markers) as private to the firm and admin.
- Treat master reports and raw `data/server-state.json` as facilitator-only and sensitive. The JSON state includes game data and credential hashes; keep backups private.
- Industry reports contain per-firm comparisons and are not exposed to players by the online API.
- Invite and rejoin secrets are cryptographically random, returned once, and stored on the server as hashes. They are carried in the browser URL fragment for entry, then removed from the address bar; API requests use token headers. Never put them in screenshots, public posts, source control, or shared logs.
- Player session tokens are kept in browser local storage. Do not use shared or untrusted browser profiles. The admin token lives in tab session storage and in the server process environment.

## Remaining hardening before stable/public production

- Quick Tunnel is temporary and has no availability guarantee. For a stable public hostname, use an explicitly configured named tunnel/domain and review Cloudflare Access or another access policy.
- The app has no per-IP rate limiting or automated abuse controls. Invite secrecy and high-entropy tokens are not a substitute for production monitoring.
- Back up `data/server-state.json` while the server is stopped and test restore before important games.
- Keep the server bound to loopback. Do not expose the Node port directly or point a public tunnel at the Vite development server.
- Maintain API regression tests for unauthorized access, cross-firm isolation, token rotation, closed-game behavior, and private report payloads.
