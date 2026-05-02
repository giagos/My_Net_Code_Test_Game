(function () {
  "use strict";

  var VERSION = "0.1.0";
  var GRID_SIZE = 7;
  var TILE_COUNT = GRID_SIZE * GRID_SIZE;
  var ICE_SERVERS = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" }
  ];

  var els = {};
  var state = {
    mode: null,
    selectedPane: "host",
    roundId: 0,
    log: [],
    connection: {
      role: null,
      status: "idle",
      pc: null,
      channel: null,
      localName: "Player",
      remoteName: "Opponent",
      error: ""
    },
    seedExchange: null,
    game: null
  };

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    cacheElements();
    bindEvents();
    buildEmptyBoard();
    logEvent("Ready.");
    render();
  }

  function cacheElements() {
    var ids = [
      "statusLine", "connectionPill", "rolePill", "turnPill", "playerName",
      "playerOne", "playerTwo", "playerOneName", "playerTwoName", "playerOneStatus", "playerTwoStatus",
      "diceFace", "rollButton", "opensRemaining", "bombCount", "roundNumber",
      "board", "boardShade", "shadeTitle", "shadeText", "selectHost", "selectJoin", "hostPane", "joinPane",
      "hostButton", "inviteCode", "copyInviteButton", "hostAnswerCode", "acceptAnswerButton",
      "joinInviteCode", "joinButton", "answerCode", "copyAnswerButton", "startLocalButton", "eventLog",
      "resultOverlay", "resultIcon", "resultTitle", "resultBody", "continueButton"
    ];

    ids.forEach(function (id) {
      els[id] = document.getElementById(id);
    });
  }

  function bindEvents() {
    els.playerName.addEventListener("input", function () {
      state.connection.localName = cleanName(els.playerName.value);
      sendMessage({ type: "hello", name: state.connection.localName, version: VERSION });
      syncPlayerNames();
      render();
    });

    els.selectHost.addEventListener("click", function () { selectPane("host"); });
    els.selectJoin.addEventListener("click", function () { selectPane("join"); });
    els.hostButton.addEventListener("click", createHostInvite);
    els.acceptAnswerButton.addEventListener("click", acceptAnswer);
    els.joinButton.addEventListener("click", createJoinAnswer);
    els.copyInviteButton.addEventListener("click", function () { copyText(els.inviteCode); });
    els.copyAnswerButton.addEventListener("click", function () { copyText(els.answerCode); });
    els.hostAnswerCode.addEventListener("input", render);
    els.joinInviteCode.addEventListener("input", render);
    els.startLocalButton.addEventListener("click", startLocalDuel);
    els.rollButton.addEventListener("click", rollDie);
    els.board.addEventListener("click", handleBoardClick);
    els.continueButton.addEventListener("click", continueRound);
  }

  function selectPane(pane) {
    state.selectedPane = pane;
    renderConnectionPane();
  }

  async function createHostInvite() {
    try {
      resetNetwork(false);
      state.mode = "p2p";
      state.connection.role = "host";
      state.connection.status = "creating";
      state.connection.error = "";
      render();

      var pc = createPeerConnection();
      state.connection.pc = pc;
      var channel = pc.createDataChannel("mine-roll-duel", { ordered: true });
      wireDataChannel(channel);

      var offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitForIceGathering(pc);

      var payload = {
        app: "MineRollDuel",
        version: VERSION,
        type: "offer",
        description: pc.localDescription
      };

      els.inviteCode.value = encodePayload(payload);
      state.connection.status = "invite-ready";
      logEvent("Invite created.", "good");
      render();
    } catch (error) {
      showNetworkError(error);
    }
  }

  async function acceptAnswer() {
    try {
      var payload = decodePayload(els.hostAnswerCode.value);
      assertPayload(payload, "answer");

      if (!state.connection.pc) {
        throw new Error("Create an invite first.");
      }

      state.connection.status = "connecting";
      render();
      await state.connection.pc.setRemoteDescription(payload.description);
      logEvent("Answer accepted.", "good");
      render();
    } catch (error) {
      showNetworkError(error);
    }
  }

  async function createJoinAnswer() {
    try {
      var offerPayload = decodePayload(els.joinInviteCode.value);
      assertPayload(offerPayload, "offer");

      resetNetwork(false);
      state.mode = "p2p";
      state.connection.role = "guest";
      state.connection.status = "creating";
      state.connection.error = "";
      render();

      var pc = createPeerConnection();
      state.connection.pc = pc;
      pc.addEventListener("datachannel", function (event) {
        wireDataChannel(event.channel);
      });

      await pc.setRemoteDescription(offerPayload.description);
      var answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await waitForIceGathering(pc);

      var answerPayload = {
        app: "MineRollDuel",
        version: VERSION,
        type: "answer",
        description: pc.localDescription
      };

      els.answerCode.value = encodePayload(answerPayload);
      state.connection.status = "answer-ready";
      logEvent("Answer created.", "good");
      render();
    } catch (error) {
      showNetworkError(error);
    }
  }

  function createPeerConnection() {
    var pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    pc.addEventListener("connectionstatechange", function () {
      var status = pc.connectionState;
      if (status === "connected") {
        state.connection.status = "connected";
      } else if (status === "failed" || status === "disconnected" || status === "closed") {
        state.connection.status = status;
      } else if (status === "connecting") {
        state.connection.status = "connecting";
      }
      render();
    });

    pc.addEventListener("iceconnectionstatechange", function () {
      if (pc.iceConnectionState === "failed") {
        state.connection.status = "failed";
        state.connection.error = "Peer route failed.";
        logEvent("Peer route failed.", "bad");
        render();
      }
    });

    return pc;
  }

  function wireDataChannel(channel) {
    state.connection.channel = channel;

    channel.addEventListener("open", function () {
      state.connection.status = "connected";
      state.connection.error = "";
      sendMessage({ type: "hello", name: state.connection.localName, version: VERSION });
      logEvent("Encrypted peer link open.", "good");
      startSeedExchange(state.roundId + 1);
      render();
    });

    channel.addEventListener("message", function (event) {
      handleMessage(event.data);
    });

    channel.addEventListener("close", function () {
      state.connection.status = "closed";
      logEvent("Peer link closed.", "warn");
      render();
    });

    channel.addEventListener("error", function () {
      state.connection.status = "failed";
      state.connection.error = "Data channel error.";
      logEvent("Data channel error.", "bad");
      render();
    });
  }

  async function waitForIceGathering(pc) {
    if (pc.iceGatheringState === "complete") {
      return;
    }

    await new Promise(function (resolve) {
      var done = false;
      var timeoutId = window.setTimeout(finish, 6500);

      function finish() {
        if (done) {
          return;
        }
        done = true;
        window.clearTimeout(timeoutId);
        pc.removeEventListener("icegatheringstatechange", checkState);
        pc.removeEventListener("icecandidate", checkCandidate);
        resolve();
      }

      function checkState() {
        if (pc.iceGatheringState === "complete") {
          finish();
        }
      }

      function checkCandidate(event) {
        if (!event.candidate) {
          finish();
        }
      }

      pc.addEventListener("icegatheringstatechange", checkState);
      pc.addEventListener("icecandidate", checkCandidate);
    });
  }

  async function startSeedExchange(roundId) {
    state.roundId = roundId;
    state.seedExchange = {
      roundId: roundId,
      localSeed: randomHex(32),
      localCommit: "",
      localRevealSent: false,
      remoteCommit: "",
      remoteSeed: "",
      pendingReveal: "",
      started: false
    };
    state.game = null;
    buildEmptyBoard();
    state.seedExchange.localCommit = await sha256(state.seedExchange.localSeed);

    sendMessage({
      type: "seedCommit",
      roundId: roundId,
      role: state.connection.role,
      name: state.connection.localName,
      commit: state.seedExchange.localCommit
    });

    logEvent("Round seed locked.", "good");
    maybeRevealSeed();
    render();
  }

  async function handleMessage(raw) {
    var message;
    try {
      message = JSON.parse(raw);
    } catch (error) {
      logEvent("Unreadable peer message.", "bad");
      return;
    }

    if (!message || typeof message.type !== "string") {
      return;
    }

    if (message.type === "hello") {
      state.connection.remoteName = cleanName(message.name || "Opponent");
      syncPlayerNames();
      render();
      return;
    }

    if (message.type === "seedCommit") {
      await receiveSeedCommit(message);
      return;
    }

    if (message.type === "seedReveal") {
      await receiveSeedReveal(message);
      return;
    }

    if (message.type === "gameAction") {
      receiveGameAction(message);
      return;
    }

    if (message.type === "newRound") {
      if (typeof message.roundId === "number" && message.roundId > state.roundId) {
        logEvent("Next round accepted.", "good");
        startSeedExchange(message.roundId);
      }
    }
  }

  async function receiveSeedCommit(message) {
    if (!state.seedExchange || state.seedExchange.roundId !== message.roundId) {
      await startSeedExchange(message.roundId);
    }

    state.connection.remoteName = cleanName(message.name || state.connection.remoteName);
    state.seedExchange.remoteCommit = String(message.commit || "");
    if (state.seedExchange.pendingReveal) {
      await receiveSeedReveal({ roundId: message.roundId, seed: state.seedExchange.pendingReveal });
      state.seedExchange.pendingReveal = "";
      return;
    }
    maybeRevealSeed();
    render();
  }

  async function receiveSeedReveal(message) {
    if (!state.seedExchange || state.seedExchange.roundId !== message.roundId) {
      return;
    }

    if (!state.seedExchange.remoteCommit) {
      state.seedExchange.pendingReveal = String(message.seed || "");
      return;
    }

    var seed = String(message.seed || "");
    var commit = await sha256(seed);
    if (commit !== state.seedExchange.remoteCommit) {
      state.connection.status = "failed";
      state.connection.error = "Seed check failed.";
      logEvent("Seed check failed.", "bad");
      render();
      return;
    }

    state.seedExchange.remoteSeed = seed;
    await maybeStartSharedGame();
  }

  function maybeRevealSeed() {
    var exchange = state.seedExchange;
    if (!exchange || !exchange.localCommit || !exchange.remoteCommit || exchange.localRevealSent) {
      return;
    }

    exchange.localRevealSent = true;
    sendMessage({
      type: "seedReveal",
      roundId: exchange.roundId,
      seed: exchange.localSeed
    });
  }

  async function maybeStartSharedGame() {
    var exchange = state.seedExchange;
    if (!exchange || exchange.started || !exchange.localSeed || !exchange.remoteSeed) {
      maybeRevealSeed();
      return;
    }

    exchange.started = true;
    var hostSeed = state.connection.role === "host" ? exchange.localSeed : exchange.remoteSeed;
    var guestSeed = state.connection.role === "guest" ? exchange.localSeed : exchange.remoteSeed;
    var roundSeed = await sha256("mine-roll-duel|" + exchange.roundId + "|host:" + hostSeed + "|guest:" + guestSeed);
    startGame(roundSeed, "p2p");
  }

  async function startLocalDuel() {
    resetNetwork(true);
    state.mode = "local";
    state.roundId += 1;
    var localSeed = await sha256("local|" + randomHex(32) + "|" + Date.now());
    startGame(localSeed, "local");
    logEvent("Local duel started.", "good");
  }

  function startGame(roundSeed, mode) {
    var board = createBoard(roundSeed);
    var players = mode === "local" ? [
      { id: "host", role: "host", name: "Player A", label: "Host" },
      { id: "guest", role: "guest", name: "Player B", label: "Guest" }
    ] : [
      { id: "host", role: "host", name: nameForRole("host"), label: "Host" },
      { id: "guest", role: "guest", name: nameForRole("guest"), label: "Guest" }
    ];

    state.game = {
      phase: "playing",
      mode: mode,
      roundSeed: roundSeed,
      players: players,
      activeIndex: hash32(roundSeed + ":start") % 2,
      turnNumber: 0,
      awaitingRoll: true,
      rollValue: null,
      opensRemaining: 0,
      opened: new Array(TILE_COUNT).fill(false),
      bombs: board.bombs,
      adjacency: board.adjacency,
      bombCount: board.bombs.size,
      safeOpened: 0,
      explodedIndex: null,
      winnerId: null,
      loserId: null,
      endReason: ""
    };

    syncPlayerNames();
    logEvent(activePlayer().name + " starts.", "warn");
    render();
  }

  function rollDie() {
    var game = state.game;
    if (!game || !canUseTurnControls() || !game.awaitingRoll) {
      return;
    }

    var roll = rollForTurn(game.roundSeed, game.turnNumber);
    var action = { type: "roll", turnNumber: game.turnNumber, roll: roll, actor: activePlayer().id };
    applyAction(action);
    sendGameAction(action);
  }

  function handleBoardClick(event) {
    var button = event.target.closest(".cell");
    if (!button) {
      return;
    }

    var index = Number(button.dataset.index);
    var game = state.game;
    if (!game || !canUseTurnControls() || game.awaitingRoll || game.opensRemaining <= 0 || game.opened[index]) {
      return;
    }

    var action = { type: "open", turnNumber: game.turnNumber, index: index, actor: activePlayer().id };
    applyAction(action);
    sendGameAction(action);
  }

  function receiveGameAction(message) {
    if (!state.game || message.roundId !== state.roundId) {
      return;
    }

    var action = message.action;
    if (!action || action.actor === localRole()) {
      return;
    }

    applyAction(action);
  }

  function applyAction(action) {
    var game = state.game;
    if (!game || game.phase !== "playing") {
      return false;
    }

    if (action.actor !== activePlayer().id || action.turnNumber !== game.turnNumber) {
      logEvent("Ignored out-of-turn move.", "warn");
      return false;
    }

    if (action.type === "roll") {
      if (!game.awaitingRoll) {
        return false;
      }

      var expectedRoll = rollForTurn(game.roundSeed, game.turnNumber);
      if (action.roll !== expectedRoll) {
        logEvent("Ignored mismatched roll.", "bad");
        return false;
      }

      game.rollValue = action.roll;
      game.opensRemaining = action.roll;
      game.awaitingRoll = false;
      pulseDice();
      logEvent(activePlayer().name + " rolled " + action.roll + ".");
      render();
      return true;
    }

    if (action.type === "open") {
      if (game.awaitingRoll || game.opensRemaining <= 0 || !isValidTile(action.index) || game.opened[action.index]) {
        return false;
      }

      openTile(action.index);
      render();
      return true;
    }

    return false;
  }

  function openTile(index) {
    var game = state.game;
    var player = activePlayer();
    game.opened[index] = true;

    if (game.bombs.has(index)) {
      game.explodedIndex = index;
      game.phase = "ended";
      game.loserId = player.id;
      game.winnerId = otherPlayer().id;
      game.endReason = "bomb";
      logEvent(player.name + " hit a bomb.", "bad");
      return;
    }

    game.safeOpened += 1;
    game.opensRemaining -= 1;
    logEvent(player.name + " opened " + cellLabel(index) + ".");

    if (game.safeOpened >= TILE_COUNT - game.bombCount) {
      game.phase = "ended";
      game.winnerId = player.id;
      game.loserId = otherPlayer().id;
      game.endReason = "clear";
      logEvent(player.name + " cleared the field.", "good");
      return;
    }

    if (game.opensRemaining === 0) {
      game.turnNumber += 1;
      game.activeIndex = game.activeIndex === 0 ? 1 : 0;
      game.awaitingRoll = true;
      game.rollValue = null;
      logEvent(activePlayer().name + " is up.", "warn");
    }
  }

  function continueRound() {
    if (state.mode === "local") {
      startLocalDuel();
      return;
    }

    if (isChannelOpen()) {
      var nextRound = state.roundId + 1;
      sendMessage({ type: "newRound", roundId: nextRound });
      startSeedExchange(nextRound);
    }
  }

  function sendGameAction(action) {
    if (state.mode !== "p2p") {
      return;
    }

    sendMessage({
      type: "gameAction",
      roundId: state.roundId,
      action: action
    });
  }

  function sendMessage(message) {
    if (!isChannelOpen()) {
      return false;
    }

    state.connection.channel.send(JSON.stringify(message));
    return true;
  }

  function render() {
    renderStatus();
    renderConnectionPane();
    renderPlayers();
    renderControls();
    renderBoard();
    renderLog();
    renderResult();
  }

  function renderStatus() {
    var status = state.connection.status;
    var connectionLabel = "Offline";
    var statusClass = "status-pill";

    if (state.mode === "local") {
      connectionLabel = "Local";
      statusClass += " good";
    } else if (status === "connected") {
      connectionLabel = "P2P linked";
      statusClass += " good";
    } else if (status === "invite-ready") {
      connectionLabel = "Invite ready";
    } else if (status === "answer-ready") {
      connectionLabel = "Answer ready";
    } else if (status === "creating" || status === "connecting") {
      connectionLabel = "Connecting";
    } else if (status === "failed" || status === "disconnected" || status === "closed") {
      connectionLabel = "Link down";
      statusClass += " bad";
    }

    els.connectionPill.className = statusClass;
    els.connectionPill.textContent = connectionLabel;

    els.rolePill.textContent = state.mode === "local" ? "Same screen" : (state.connection.role ? titleCase(state.connection.role) : "No role");

    var game = state.game;
    if (!game) {
      els.turnPill.textContent = "Standby";
      els.statusLine.textContent = state.connection.error || statusLineForConnection();
      return;
    }

    if (game.phase === "ended") {
      els.turnPill.textContent = "Round over";
      els.statusLine.textContent = resultText().body;
      return;
    }

    els.turnPill.textContent = activePlayer().name + " turn";
    if (game.awaitingRoll) {
      els.statusLine.textContent = activePlayer().name + " needs a d6 roll.";
    } else {
      els.statusLine.textContent = activePlayer().name + " must open " + game.opensRemaining + " more.";
    }
  }

  function statusLineForConnection() {
    if (state.connection.status === "invite-ready") {
      return "Send the invite code, then paste the answer.";
    }
    if (state.connection.status === "answer-ready") {
      return "Send the answer code back to the host.";
    }
    if (state.connection.status === "connected" && state.seedExchange && !state.game) {
      return "Syncing the round seed.";
    }
    if (state.connection.status === "creating") {
      return "Building peer route.";
    }
    if (state.connection.status === "connecting") {
      return "Opening encrypted peer link.";
    }
    return "Create a match or join one.";
  }

  function renderConnectionPane() {
    var hostActive = state.selectedPane === "host";
    els.selectHost.classList.toggle("active", hostActive);
    els.selectJoin.classList.toggle("active", !hostActive);
    els.selectHost.setAttribute("aria-selected", String(hostActive));
    els.selectJoin.setAttribute("aria-selected", String(!hostActive));
    els.hostPane.classList.toggle("active", hostActive);
    els.joinPane.classList.toggle("active", !hostActive);

    els.copyInviteButton.disabled = !els.inviteCode.value;
    els.copyAnswerButton.disabled = !els.answerCode.value;
    els.acceptAnswerButton.disabled = !state.connection.pc || !els.hostAnswerCode.value.trim();
  }

  function renderPlayers() {
    var game = state.game;
    var hostName = game ? game.players[0].name : nameForRole("host");
    var guestName = game ? game.players[1].name : nameForRole("guest");
    els.playerOneName.textContent = hostName;
    els.playerTwoName.textContent = guestName;

    var strips = [els.playerOne, els.playerTwo];
    strips.forEach(function (strip) {
      strip.className = "player-strip";
    });

    if (!game) {
      els.playerOneStatus.textContent = state.connection.role === "host" ? "you" : "waiting";
      els.playerTwoStatus.textContent = state.connection.role === "guest" ? "you" : "waiting";
      if (state.connection.role === "host") {
        els.playerOne.classList.add("me");
      }
      if (state.connection.role === "guest") {
        els.playerTwo.classList.add("me");
      }
      return;
    }

    var activeId = activePlayer().id;
    game.players.forEach(function (player, index) {
      var strip = strips[index];
      var statusEl = index === 0 ? els.playerOneStatus : els.playerTwoStatus;
      if (player.id === activeId && game.phase === "playing") {
        strip.classList.add("active");
      }
      if (game.mode !== "local" && player.id === localRole()) {
        strip.classList.add("me");
      }
      if (player.id === game.winnerId) {
        strip.classList.add("winner");
      }
      if (player.id === game.loserId) {
        strip.classList.add("loser");
      }

      if (game.phase === "ended") {
        statusEl.textContent = player.id === game.winnerId ? "won" : "lost";
      } else if (player.id === activeId) {
        statusEl.textContent = game.awaitingRoll ? "roll" : "open " + game.opensRemaining;
      } else {
        statusEl.textContent = "waiting";
      }
    });
  }

  function renderControls() {
    var game = state.game;
    var canRoll = Boolean(game && game.phase === "playing" && game.awaitingRoll && canUseTurnControls());
    els.rollButton.disabled = !canRoll;
    els.diceFace.textContent = game && game.rollValue ? String(game.rollValue) : "?";
    els.opensRemaining.textContent = game ? String(game.opensRemaining) : "0";
    els.bombCount.textContent = game ? String(game.bombCount) : "-";
    els.roundNumber.textContent = String(state.roundId || 0);
  }

  function renderBoard() {
    var game = state.game;
    els.board.innerHTML = "";

    for (var index = 0; index < TILE_COUNT; index += 1) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "cell";
      button.dataset.index = String(index);
      button.setAttribute("role", "gridcell");

      if (!game) {
        button.disabled = true;
        button.setAttribute("aria-label", "Closed tile");
        els.board.appendChild(button);
        continue;
      }

      var isBomb = game.bombs.has(index);
      var isOpen = game.opened[index];
      var revealBomb = game.phase === "ended" && isBomb;
      var canOpen = game.phase === "playing" && canUseTurnControls() && !game.awaitingRoll && game.opensRemaining > 0 && !isOpen;

      if (isOpen && !isBomb) {
        var count = game.adjacency[index];
        button.classList.add("open", "count-" + count);
        if (count > 0) {
          var span = document.createElement("span");
          span.className = "cell-number";
          span.textContent = String(count);
          button.appendChild(span);
        }
        button.disabled = true;
        button.setAttribute("aria-label", "Open safe tile " + cellLabel(index) + ", " + count + " nearby bombs");
      } else if (revealBomb) {
        button.classList.add("bomb");
        if (game.explodedIndex === index) {
          button.classList.add("exploded");
        }
        var img = document.createElement("img");
        img.src = "./assets/mine.svg";
        img.alt = "";
        button.appendChild(img);
        button.disabled = true;
        button.setAttribute("aria-label", "Bomb at " + cellLabel(index));
      } else {
        if (canOpen) {
          button.classList.add("selectable");
        }
        button.disabled = !canOpen;
        button.setAttribute("aria-label", "Closed tile " + cellLabel(index));
      }

      els.board.appendChild(button);
    }

    var shade = shadeMessage();
    if (shade) {
      els.boardShade.hidden = false;
      els.shadeTitle.textContent = shade.title;
      els.shadeText.textContent = shade.text;
    } else {
      els.boardShade.hidden = true;
    }
  }

  function shadeMessage() {
    if (!state.game) {
      if (state.connection.status === "connected") {
        return { title: "Seed sync", text: "Locking the new board." };
      }
      if (state.connection.status === "invite-ready") {
        return { title: "Invite ready", text: "Waiting for the answer code." };
      }
      if (state.connection.status === "answer-ready") {
        return { title: "Answer ready", text: "Waiting for the host." };
      }
      return { title: "Ready room", text: "Host or join to arm the field." };
    }

    if (state.game.phase === "playing" && !canUseTurnControls()) {
      return { title: "Opponent turn", text: activePlayer().name + " controls the field." };
    }

    return null;
  }

  function renderLog() {
    els.eventLog.innerHTML = "";
    state.log.forEach(function (entry) {
      var item = document.createElement("li");
      item.className = entry.tone || "";
      item.textContent = entry.text;
      els.eventLog.appendChild(item);
    });
  }

  function renderResult() {
    var game = state.game;
    if (!game || game.phase !== "ended") {
      els.resultOverlay.hidden = true;
      return;
    }

    var text = resultText();
    els.resultTitle.textContent = text.title;
    els.resultBody.textContent = text.body;
    els.resultIcon.src = text.won ? "./assets/crown.svg" : "./assets/mine.svg";
    els.continueButton.disabled = state.mode === "p2p" && !isChannelOpen();
    els.resultOverlay.hidden = false;
  }

  function resultText() {
    var game = state.game;
    if (!game) {
      return { title: "Round over", body: "The field is quiet.", won: false };
    }

    var localWon = state.mode === "local" ? true : game.winnerId === localRole();
    var winner = game.players.find(function (player) { return player.id === game.winnerId; });
    var loser = game.players.find(function (player) { return player.id === game.loserId; });

    if (state.mode === "local") {
      return {
        title: winner.name + " won",
        body: game.endReason === "bomb" ? loser.name + " opened a bomb." : winner.name + " cleared every safe tile.",
        won: true
      };
    }

    return {
      title: localWon ? "You won" : "You lost",
      body: game.endReason === "bomb" ? loser.name + " opened a bomb." : winner.name + " cleared every safe tile.",
      won: localWon
    };
  }

  function buildEmptyBoard() {
    if (!els.board) {
      return;
    }

    els.board.innerHTML = "";
    for (var index = 0; index < TILE_COUNT; index += 1) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "cell";
      button.disabled = true;
      button.setAttribute("role", "gridcell");
      button.setAttribute("aria-label", "Closed tile");
      els.board.appendChild(button);
    }
  }

  function createBoard(seed) {
    var rng = mulberry32(hash32(seed + ":board"));
    var bombCount = 1 + Math.floor(rng() * 6);
    var indices = [];
    var bombs = new Set();
    var adjacency = new Array(TILE_COUNT).fill(0);

    for (var index = 0; index < TILE_COUNT; index += 1) {
      indices.push(index);
    }

    for (var i = indices.length - 1; i > 0; i -= 1) {
      var j = Math.floor(rng() * (i + 1));
      var temp = indices[i];
      indices[i] = indices[j];
      indices[j] = temp;
    }

    indices.slice(0, bombCount).forEach(function (index) {
      bombs.add(index);
    });

    for (var tile = 0; tile < TILE_COUNT; tile += 1) {
      if (bombs.has(tile)) {
        continue;
      }

      adjacency[tile] = neighbors(tile).filter(function (neighbor) {
        return bombs.has(neighbor);
      }).length;
    }

    return { bombs: bombs, adjacency: adjacency };
  }

  function neighbors(index) {
    var row = Math.floor(index / GRID_SIZE);
    var col = index % GRID_SIZE;
    var result = [];

    for (var rowStep = -1; rowStep <= 1; rowStep += 1) {
      for (var colStep = -1; colStep <= 1; colStep += 1) {
        if (rowStep === 0 && colStep === 0) {
          continue;
        }
        var nextRow = row + rowStep;
        var nextCol = col + colStep;
        if (nextRow >= 0 && nextRow < GRID_SIZE && nextCol >= 0 && nextCol < GRID_SIZE) {
          result.push(nextRow * GRID_SIZE + nextCol);
        }
      }
    }

    return result;
  }

  function rollForTurn(seed, turnNumber) {
    return (hash32(seed + ":roll:" + turnNumber) % 6) + 1;
  }

  function activePlayer() {
    return state.game.players[state.game.activeIndex];
  }

  function otherPlayer() {
    return state.game.players[state.game.activeIndex === 0 ? 1 : 0];
  }

  function canUseTurnControls() {
    if (!state.game || state.game.phase !== "playing") {
      return false;
    }

    if (state.game.mode === "local") {
      return true;
    }

    return activePlayer().id === localRole() && isChannelOpen();
  }

  function localRole() {
    return state.connection.role || "host";
  }

  function nameForRole(role) {
    if (state.mode === "local") {
      return role === "host" ? "Player A" : "Player B";
    }

    if (!state.connection.role) {
      return role === "host" ? "Host" : "Guest";
    }

    if (state.connection.role === role) {
      return state.connection.localName || "Player";
    }

    return state.connection.remoteName || "Opponent";
  }

  function syncPlayerNames() {
    if (!state.game || state.game.mode === "local") {
      return;
    }

    state.game.players.forEach(function (player) {
      player.name = nameForRole(player.role);
    });
  }

  function resetNetwork(keepLog) {
    if (state.connection.channel) {
      try { state.connection.channel.close(); } catch (error) { }
    }
    if (state.connection.pc) {
      try { state.connection.pc.close(); } catch (error) { }
    }

    state.connection.pc = null;
    state.connection.channel = null;
    state.connection.role = null;
    state.connection.status = "idle";
    state.connection.error = "";
    state.seedExchange = null;
    state.game = null;
    if (!keepLog) {
      state.log = [];
    }
    buildEmptyBoard();
  }

  function isChannelOpen() {
    return Boolean(state.connection.channel && state.connection.channel.readyState === "open");
  }

  function assertPayload(payload, expectedType) {
    if (!payload || payload.app !== "MineRollDuel" || payload.type !== expectedType || !payload.description) {
      throw new Error("That code is not a valid " + expectedType + ".");
    }
  }

  function encodePayload(payload) {
    var json = JSON.stringify(payload);
    var bytes = new TextEncoder().encode(json);
    var binary = "";
    bytes.forEach(function (byte) {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function decodePayload(code) {
    var clean = String(code || "").trim().replace(/\s+/g, "");
    if (!clean) {
      throw new Error("Paste a code first.");
    }

    var normalized = clean.replace(/-/g, "+").replace(/_/g, "/");
    var padding = normalized.length % 4 ? "=".repeat(4 - (normalized.length % 4)) : "";
    var binary = atob(normalized + padding);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  async function copyText(textarea) {
    var text = textarea.value;
    if (!text) {
      return;
    }

    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        textarea.focus();
        textarea.select();
        document.execCommand("copy");
      }
      logEvent("Code copied.", "good");
    } catch (error) {
      textarea.focus();
      textarea.select();
      logEvent("Select the code manually.", "warn");
    }
  }

  function showNetworkError(error) {
    state.connection.status = "failed";
    state.connection.error = error && error.message ? error.message : "Network setup failed.";
    logEvent(state.connection.error, "bad");
    render();
  }

  function logEvent(text, tone) {
    state.log.unshift({ text: text, tone: tone || "" });
    state.log = state.log.slice(0, 9);
    if (els.eventLog) {
      renderLog();
    }
  }

  function pulseDice() {
    els.diceFace.classList.remove("rolling");
    window.requestAnimationFrame(function () {
      els.diceFace.classList.add("rolling");
    });
  }

  function cellLabel(index) {
    return String.fromCharCode(65 + Math.floor(index / GRID_SIZE)) + String((index % GRID_SIZE) + 1);
  }

  function isValidTile(index) {
    return Number.isInteger(index) && index >= 0 && index < TILE_COUNT;
  }

  function cleanName(value) {
    var name = String(value || "").trim().replace(/\s+/g, " ");
    return name || "Player";
  }

  function titleCase(value) {
    return value.slice(0, 1).toUpperCase() + value.slice(1);
  }

  function randomHex(byteLength) {
    var bytes = new Uint8Array(byteLength);
    if (window.crypto && window.crypto.getRandomValues) {
      window.crypto.getRandomValues(bytes);
    } else {
      for (var index = 0; index < byteLength; index += 1) {
        bytes[index] = Math.floor(Math.random() * 256);
      }
    }
    return bytesToHex(bytes);
  }

  async function sha256(text) {
    var bytes = new TextEncoder().encode(text);
    if (window.crypto && window.crypto.subtle) {
      var digest = await window.crypto.subtle.digest("SHA-256", bytes);
      return bytesToHex(new Uint8Array(digest));
    }

    return fallbackHash(text);
  }

  function bytesToHex(bytes) {
    return Array.prototype.map.call(bytes, function (byte) {
      return byte.toString(16).padStart(2, "0");
    }).join("");
  }

  function fallbackHash(text) {
    var parts = [
      hash32("a|" + text),
      hash32("b|" + text),
      hash32("c|" + text),
      hash32("d|" + text),
      hash32("e|" + text),
      hash32("f|" + text),
      hash32("g|" + text),
      hash32("h|" + text)
    ];
    return parts.map(function (part) {
      return part.toString(16).padStart(8, "0");
    }).join("");
  }

  function hash32(input) {
    var hash = 1779033703 ^ input.length;
    for (var index = 0; index < input.length; index += 1) {
      hash = Math.imul(hash ^ input.charCodeAt(index), 3432918353);
      hash = (hash << 13) | (hash >>> 19);
    }
    hash = Math.imul(hash ^ (hash >>> 16), 2246822507);
    hash = Math.imul(hash ^ (hash >>> 13), 3266489909);
    return (hash ^ (hash >>> 16)) >>> 0;
  }

  function mulberry32(seed) {
    return function () {
      var value = seed += 0x6D2B79F5;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }
})();