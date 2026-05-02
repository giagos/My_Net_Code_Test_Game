# Mine Roll Duel

<p align="center">
	<img src="assets/readme-preview.svg" alt="Mine Roll Duel preview" width="900">
</p>

<p align="center">
	<strong>A local-file, two-player, peer-to-peer netcode test game.</strong><br>
	Open one HTML file, exchange invite/answer codes, roll a d6, and survive a 7 by 7 mine grid.
</p>

<p align="center">
	<img src="assets/mine.svg" alt="Mine" width="56">
	<img src="assets/dice.svg" alt="Die" width="56">
	<img src="assets/link.svg" alt="Peer link" width="56">
	<img src="assets/crown.svg" alt="Win" width="56">
</p>

## Play Online

After GitHub Pages is enabled for this repository, the game can run directly from:

<p align="center">
	<a href="https://giagos.github.io/My_Net_Code_Test_Game/" target="_blank"><strong>Play Mine Roll Duel</strong></a>
</p>

GitHub README files cannot run the game by themselves. GitHub removes scripts from README content for security, so a README button can only link to the hosted page. GitHub Pages is the correct way to run these same static files from GitHub in a normal browser tab.

To enable it:

1. Push this repository to GitHub.
2. Open the repository **Settings** tab.
3. Go to **Pages**.
4. Set **Source** to **GitHub Actions**.
5. Push to `main` or run the **Deploy GitHub Pages** workflow manually.
6. Open `https://giagos.github.io/My_Net_Code_Test_Game/`.

If GitHub shows **There isn't a GitHub Pages site here**, check these things:

- The latest changes, including `.github/workflows/pages.yml`, have been pushed to GitHub.
- Repository **Settings > Pages > Source** is set to **GitHub Actions**.
- The **Deploy GitHub Pages** action has finished successfully.
- The repository owner and name in the URL are exactly right: `https://giagos.github.io/My_Net_Code_Test_Game/`.
- If the repository is private, your GitHub plan/settings must allow Pages for private repositories.

## Purpose

Mine Roll Duel was created as a test project for experimenting with browser peer-to-peer netcode without a traditional hosted game server. It is made to be easy to download, inspect, run, and modify.

Created by **Giagkos Kapetankis**.

## Download And Open

1. Click the green **Code** button on GitHub.
2. Choose **Download ZIP**.
3. Extract the ZIP file.
4. Open [index.html](index.html) in a modern browser such as Chrome, Edge, or Firefox.

No install, build command, local web server, LAN setup, or router port forwarding is required for the files themselves.

## How To Test With Two People

Both players need the same project files locally.

1. Player 1 opens [index.html](index.html).
2. Player 2 opens [index.html](index.html).
3. Player 1 uses the **Host** tab and clicks **Create invite**.
4. Player 1 sends the invite code to Player 2 using any chat app.
5. Player 2 opens the **Join** tab, pastes the invite code, then clicks **Create answer**.
6. Player 2 sends the answer code back to Player 1.
7. Player 1 pastes the answer code and clicks **Connect**.
8. When both screens show **P2P linked**, the match starts.

For a quick same-computer test, open [index.html](index.html) in two browser tabs and do the same host/join flow between the tabs.

## Game Rules

- The board is a 7 by 7 grid.
- Each round contains a random 1 to 6 hidden bombs.
- The active player rolls one d6.
- The roll decides exactly how many closed tiles that player must open.
- Opening a bomb loses the round.
- Clearing all safe tiles wins the round.
- **Local duel** starts a same-screen test match without WebRTC.

## Netcode Overview

<p align="center">
	<img src="assets/readme-netcode-flow.svg" alt="Peer to peer netcode flow" width="780">
</p>

The game uses WebRTC data channels for peer-to-peer gameplay messages. The invite and answer text boxes are the manual signaling system: instead of using a matchmaking server, the players copy and paste the connection information themselves.

What happens under the hood:

1. The host creates a WebRTC offer and copies it as an invite code.
2. The guest pastes that invite, creates a WebRTC answer, and sends it back.
3. The host applies the answer, completing negotiation.
4. WebRTC opens an encrypted data channel between the two browsers.
5. Both players run a commit/reveal seed exchange.
6. The verified shared seed generates the same bombs, same first player, and same dice rolls on both machines.

The game uses public STUN servers so browsers can discover possible peer routes. STUN is not a game server and does not store match state. On very restrictive networks, browsers may require TURN relay infrastructure; that would be a server, so it is intentionally not included in this no-backend experiment.

## Internet Play And TURN

LAN play can work with direct local candidates. Internet play is less predictable because routers, mobile carrier NAT, VPNs, firewalls, and privacy settings can block direct WebRTC UDP routes.

The **Network Debug** panel shows the important clue:

- `host` candidates are local/private routes.
- `srflx` candidates are public STUN-discovered routes.
- `relay` candidates come from a TURN server.

If internet play gets stuck with `relay=0`, add a TURN relay. Both players should choose the same connection method and enter the same TURN details before creating a fresh invite and answer.

In the game:

1. Open **Connection Method**.
2. Choose **STUN direct**, **TURN fallback**, or **TURN relay only**.
3. For TURN modes, enter a server URL such as `turn:relay.example.com:3478` or `turns:relay.example.com:5349`.
4. Enter the TURN username and credential.
5. Click **Save Method**.
6. Create a fresh invite and answer.
7. In **Network Debug**, look for `relay>0` or an `ICE server error`.

Method guide:

- **STUN direct**: no relay. Best for LAN and easy home networks.
- **TURN fallback**: tries direct routes first, then a relay if needed. Best normal internet setting.
- **TURN relay only**: forces all traffic through TURN. Best for testing if TURN works or for strict networks.

Ways to get TURN credentials:

- Use a hosted TURN provider such as Metered, Twilio, Xirsys, or similar.
- Self-host `coturn` on a VPS with UDP/TCP port `3478`, and optionally TLS on `5349`.

Do not put private TURN passwords directly into the source code for a public repository. The in-game TURN form stores them only in the current browser's local storage.

## Project Structure

```text
index.html          Browser entry point
styles.css          Layout, board visuals, responsive UI, animations
assets/             SVG icons and README images
js/config.js        Shared constants such as grid size and STUN servers
js/state.js         Central game and connection state
js/utils.js         Hashing, random seed helpers, code encoding, small utilities
js/rules.js         Board generation, neighbor counts, deterministic dice rolls
js/netcode.js       WebRTC offer/answer, data channel, messages, seed exchange
js/game.js          Turn rules, tile opening, win/loss logic, action validation
js/ui.js            DOM rendering, controls, board drawing, result screens
js/main.js          Startup wiring
```

## Security And Fairness Notes

- WebRTC data channels are encrypted by the browser with DTLS.
- The board and dice are created from both players' random seeds.
- The commit/reveal step prevents one player from choosing the board after seeing the other player's seed.
- This is casual-secure, not cheat-proof. A player can always edit their own local files or browser runtime.

## Developer Testing Checklist

Use this when changing the code:

1. Open [index.html](index.html) directly from the file system.
2. Click **Local duel**, roll, and open tiles until the turn changes.
3. Reload and open a second tab.
4. Run the host/join invite flow between the two tabs.
5. Confirm both tabs show the same bomb count and round number.
6. Roll and open one tile on the active tab.
7. Confirm the other tab mirrors the roll and opened tile.

## License

See [LICENSE](LICENSE).