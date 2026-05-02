# Mine Roll Duel

A static, local-file browser game for two players. Each player opens the same files, one player hosts, the other joins, and the game uses a WebRTC data channel for encrypted peer-to-peer moves.

## Play

1. Open [index.html](index.html) in a modern browser.
2. The host clicks **Create invite** and sends the invite code to the other player with any chat app.
3. The guest pastes the invite, clicks **Create answer**, and sends the answer code back.
4. The host pastes the answer and clicks **Connect**.
5. On each turn, roll the d6 and open exactly that many grid tiles. Opening a bomb loses the round. Clearing all safe tiles wins the round.

## Network Model

This is peer-to-peer game traffic, not a hosted game server. It uses manual invite/answer codes for signaling and public STUN servers for NAT discovery. The actual game messages travel over WebRTC with DTLS encryption.

A browser cannot make two internet players discover and reach each other with literally zero network helper. If both players are behind restrictive NATs, a TURN relay would be required, which is a server. This project does not include TURN by default because the goal is no hosted game backend, no LAN requirement, and no router port forwarding.

## Fairness And Security

- The board and dice are generated from both players' random seeds using a commit/reveal exchange.
- One player cannot pick the bomb layout after seeing the other player's seed.
- The game is casual-secure, not cheat-proof. A player can always inspect or modify their own local browser code.

## Files

- [index.html](index.html): App shell.
- [styles.css](styles.css): Responsive game UI and animations.
- [app.js](app.js): WebRTC handshake, fair seed exchange, game rules, and rendering.
- [assets](assets): Local SVG game assets.

No install, build, or local web server is required.