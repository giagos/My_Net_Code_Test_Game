(function (app) {
  "use strict";

  var els = app.dom;
  var state = app.state;

  function cacheElements() {
    var ids = [
      "statusLine", "connectionPill", "rolePill", "turnPill", "playerName",
      "playerOne", "playerTwo", "playerOneName", "playerTwoName", "playerOneStatus", "playerTwoStatus",
      "diceFace", "rollButton", "opensRemaining", "bombCount", "roundNumber",
      "board", "boardShade", "shadeTitle", "shadeText", "selectHost", "selectJoin", "hostPane", "joinPane",
      "hostButton", "inviteCode", "copyInviteButton", "hostAnswerCode", "acceptAnswerButton",
      "joinInviteCode", "joinButton", "answerCode", "copyAnswerButton", "startLocalButton", "eventLog",
      "iceMethod", "turnUrl", "turnUsername", "turnCredential", "saveTurnButton", "clearTurnButton", "turnStatus",
      "turnHelpButton", "turnHelp",
      "networkDebugLog", "copyDebugButton", "clearDebugButton", "resultOverlay", "resultIcon",
      "resultTitle", "resultBody", "continueButton"
    ];

    ids.forEach(function (id) {
      els[id] = document.getElementById(id);
    });
  }

  function bindEvents() {
    els.playerName.addEventListener("input", function () {
      state.connection.localName = app.utils.cleanName(els.playerName.value);
      app.netcode.sendMessage({ type: "hello", name: state.connection.localName, version: app.config.version });
      app.game.syncPlayerNames();
      render();
    });

    els.selectHost.addEventListener("click", function () { selectPane("host"); });
    els.selectJoin.addEventListener("click", function () { selectPane("join"); });
    els.hostButton.addEventListener("click", app.netcode.createHostInvite);
    els.acceptAnswerButton.addEventListener("click", app.netcode.acceptAnswer);
    els.joinButton.addEventListener("click", app.netcode.createJoinAnswer);
    els.copyInviteButton.addEventListener("click", function () { handleCopy(els.inviteCode); });
    els.copyAnswerButton.addEventListener("click", function () { handleCopy(els.answerCode); });
    els.iceMethod.addEventListener("change", renderUnsavedTurnMethod);
    els.turnHelpButton.addEventListener("click", toggleTurnHelp);
    els.saveTurnButton.addEventListener("click", saveTurnSettings);
    els.clearTurnButton.addEventListener("click", clearTurnSettings);
    els.copyDebugButton.addEventListener("click", copyNetworkDebug);
    els.clearDebugButton.addEventListener("click", clearNetworkDebug);
    els.hostAnswerCode.addEventListener("input", render);
    els.joinInviteCode.addEventListener("input", render);
    els.startLocalButton.addEventListener("click", app.game.startLocalDuel);
    els.rollButton.addEventListener("click", app.game.rollDie);
    els.board.addEventListener("click", app.game.handleBoardClick);
    els.continueButton.addEventListener("click", app.game.continueRound);
    loadTurnSettings();
  }

  function selectPane(pane) {
    state.selectedPane = pane;
    renderConnectionPane();
  }

  async function handleCopy(textarea) {
    try {
      var copied = await app.utils.copyText(textarea);
      logEvent(copied ? "Code copied." : "Select the code manually.", copied ? "good" : "warn");
    } catch (error) {
      textarea.focus();
      textarea.select();
      logEvent("Select the code manually.", "warn");
    }
  }

  function render() {
    renderStatus();
    renderConnectionPane();
    renderTurnSettings();
    renderPlayers();
    renderControls();
    renderBoard();
    renderLog();
    renderNetworkDebug();
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
    els.rolePill.textContent = state.mode === "local" ? "Same screen" : (state.connection.role ? app.utils.titleCase(state.connection.role) : "No role");

    if (!state.game) {
      els.turnPill.textContent = "Standby";
      els.statusLine.textContent = state.connection.error || statusLineForConnection();
      return;
    }

    if (state.game.phase === "ended") {
      els.turnPill.textContent = "Round over";
      els.statusLine.textContent = resultText().body;
      return;
    }

    els.turnPill.textContent = app.game.activePlayer().name + " turn";
    els.statusLine.textContent = state.game.awaitingRoll
      ? app.game.activePlayer().name + " needs a d6 roll."
      : app.game.activePlayer().name + " must open " + state.game.opensRemaining + " more.";
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
    els.acceptAnswerButton.disabled = !app.netcode.canAcceptAnswer() || !els.hostAnswerCode.value.trim();
  }

  function loadTurnSettings() {
    var settings = app.netcode.loadTurnSettings();

    els.iceMethod.value = settings.method || "stun";
    els.turnUrl.value = settings.urls || "";
    els.turnUsername.value = settings.username || "";
    els.turnCredential.value = settings.credential || "";
    setTurnFieldAvailability(els.iceMethod.value);
    renderTurnSettings();
  }

  function saveTurnSettings() {
    try {
      var saved = app.netcode.saveTurnSettings({
        method: els.iceMethod.value,
        urls: els.turnUrl.value,
        username: els.turnUsername.value,
        credential: els.turnCredential.value
      });

      if (!saved) {
        els.turnUrl.value = "";
        els.turnUsername.value = "";
        els.turnCredential.value = "";
      }

      setTurnFieldAvailability(els.iceMethod.value);
      logEvent(saved ? "Connection method saved." : "Using STUN direct.", saved ? "good" : "warn");
      renderTurnSettings();
    } catch (error) {
      logEvent(error && error.message ? error.message : "TURN relay not saved.", "bad");
    }
  }

  function clearTurnSettings() {
    app.netcode.clearTurnSettings();
    els.iceMethod.value = "stun";
    els.turnUrl.value = "";
    els.turnUsername.value = "";
    els.turnCredential.value = "";
    setTurnFieldAvailability("stun");
    logEvent("TURN relay cleared.", "warn");
    renderTurnSettings();
  }

  function renderTurnSettings() {
    var settings = app.netcode.loadTurnSettings();
    var selectedMethod = els.iceMethod.value || settings.method || "stun";

    setTurnFieldAvailability(selectedMethod);

    if (selectedMethod !== settings.method) {
      renderUnsavedTurnMethod();
      els.clearTurnButton.disabled = !settings.urls;
      return;
    }

    if (selectedMethod === "stun") {
      els.turnStatus.textContent = "Method: STUN direct. TURN fields are locked.";
      els.clearTurnButton.disabled = !settings.urls;
      return;
    }

    if (selectedMethod === "relay") {
      els.turnStatus.textContent = settings.urls ? "Method: TURN relay only via " + settings.urls : "Method: TURN relay only needs a server URL.";
      els.clearTurnButton.disabled = !settings.urls;
      return;
    }

    els.turnStatus.textContent = settings.urls ? "Method: TURN fallback via " + settings.urls : "Method: TURN fallback needs a server URL.";
    els.clearTurnButton.disabled = !settings.urls;
  }

  function renderUnsavedTurnMethod() {
    setTurnFieldAvailability(els.iceMethod.value);

    if (els.iceMethod.value === "stun") {
      var settings = app.netcode.loadTurnSettings();
      els.turnStatus.textContent = settings.urls ? "Method: STUN direct. TURN fields are locked. Save to clear TURN settings." : "Method: STUN direct. TURN fields are locked.";
      return;
    }

    if (els.iceMethod.value === "relay") {
      els.turnStatus.textContent = "Method: TURN relay only. Save before creating an invite or answer.";
      return;
    }

    els.turnStatus.textContent = "Method: TURN fallback. Save before creating an invite or answer.";
  }

  function setTurnFieldAvailability(method) {
    var usesTurnFields = method !== "stun";

    els.turnUrl.disabled = !usesTurnFields;
    els.turnUsername.disabled = !usesTurnFields;
    els.turnCredential.disabled = !usesTurnFields;
    els.turnUrl.required = usesTurnFields;
  }

  function toggleTurnHelp() {
    var isHidden = els.turnHelp.hidden;

    els.turnHelp.hidden = !isHidden;
    els.turnHelpButton.setAttribute("aria-expanded", String(isHidden));
    els.turnHelpButton.textContent = isHidden ? "Hide" : "Help";
  }

  function renderPlayers() {
    var game = state.game;
    var hostName = game ? game.players[0].name : app.game.nameForRole("host");
    var guestName = game ? game.players[1].name : app.game.nameForRole("guest");
    var strips = [els.playerOne, els.playerTwo];

    els.playerOneName.textContent = hostName;
    els.playerTwoName.textContent = guestName;

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

    game.players.forEach(function (player, index) {
      var strip = strips[index];
      var statusEl = index === 0 ? els.playerOneStatus : els.playerTwoStatus;

      if (player.id === app.game.activePlayer().id && game.phase === "playing") {
        strip.classList.add("active");
      }
      if (game.mode !== "local" && player.id === app.game.localRole()) {
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
      } else if (player.id === app.game.activePlayer().id) {
        statusEl.textContent = game.awaitingRoll ? "roll" : "open " + game.opensRemaining;
      } else {
        statusEl.textContent = "waiting";
      }
    });
  }

  function renderControls() {
    var game = state.game;
    var canRoll = Boolean(game && game.phase === "playing" && game.awaitingRoll && app.game.canUseTurnControls());

    els.rollButton.disabled = !canRoll;
    els.diceFace.textContent = game && game.rollValue ? String(game.rollValue) : "?";
    els.opensRemaining.textContent = game ? String(game.opensRemaining) : "0";
    els.bombCount.textContent = game ? String(game.bombCount) : "-";
    els.roundNumber.textContent = String(state.roundId || 0);
  }

  function renderBoard() {
    var game = state.game;
    els.board.innerHTML = "";

    for (var index = 0; index < app.config.tileCount; index += 1) {
      els.board.appendChild(createCell(index, game));
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

  function createCell(index, game) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "cell";
    button.dataset.index = String(index);
    button.setAttribute("role", "gridcell");

    if (!game) {
      button.disabled = true;
      button.setAttribute("aria-label", "Closed tile");
      return button;
    }

    var isBomb = game.bombs.has(index);
    var isOpen = game.opened[index];
    var revealBomb = game.phase === "ended" && isBomb;
    var canOpen = game.phase === "playing" && app.game.canUseTurnControls() && !game.awaitingRoll && game.opensRemaining > 0 && !isOpen;

    if (isOpen && !isBomb) {
      decorateOpenCell(button, index, game.adjacency[index]);
    } else if (revealBomb) {
      decorateBombCell(button, index, game.explodedIndex === index);
    } else {
      if (canOpen) {
        button.classList.add("selectable");
      }
      button.disabled = !canOpen;
      button.setAttribute("aria-label", "Closed tile " + app.utils.cellLabel(index));
    }

    return button;
  }

  function decorateOpenCell(button, index, count) {
    button.classList.add("open", "count-" + count);

    if (count > 0) {
      var span = document.createElement("span");
      span.className = "cell-number";
      span.textContent = String(count);
      button.appendChild(span);
    }

    button.disabled = true;
    button.setAttribute("aria-label", "Open safe tile " + app.utils.cellLabel(index) + ", " + count + " nearby bombs");
  }

  function decorateBombCell(button, index, exploded) {
    button.classList.add("bomb");

    if (exploded) {
      button.classList.add("exploded");
    }

    var img = document.createElement("img");
    img.src = "./assets/mine.svg";
    img.alt = "";
    button.appendChild(img);
    button.disabled = true;
    button.setAttribute("aria-label", "Bomb at " + app.utils.cellLabel(index));
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

    if (state.game.phase === "playing" && !app.game.canUseTurnControls()) {
      return { title: "Opponent turn", text: app.game.activePlayer().name + " controls the field." };
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

  function renderNetworkDebug() {
    if (!els.networkDebugLog) {
      return;
    }

    els.networkDebugLog.innerHTML = "";

    if (!state.networkDebug.length) {
      var emptyItem = document.createElement("li");
      emptyItem.className = "empty";
      emptyItem.textContent = "No network events yet.";
      els.networkDebugLog.appendChild(emptyItem);
    } else {
      state.networkDebug.forEach(function (entry) {
        var item = document.createElement("li");
        item.className = entry.tone || "";
        item.textContent = formatDebugEntry(entry);
        els.networkDebugLog.appendChild(item);
      });
    }

    els.copyDebugButton.disabled = !state.networkDebug.length;
    els.clearDebugButton.disabled = !state.networkDebug.length;
  }

  function formatDebugEntry(entry) {
    var pieces = ["[" + entry.time + "]", entry.role || "none", entry.topic];

    if (entry.detail) {
      pieces.push(entry.detail);
    }

    return pieces.join(" | ");
  }

  function formatNetworkDebug() {
    return state.networkDebug.map(formatDebugEntry).join("\n");
  }

  async function copyNetworkDebug() {
    var text = formatNetworkDebug();

    if (!text) {
      logEvent("Debug log is empty.", "warn");
      return;
    }

    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        copyTextFallback(text);
      }

      logEvent("Debug copied.", "good");
    } catch (error) {
      logEvent("Could not copy debug.", "warn");
    }
  }

  function copyTextFallback(text) {
    var textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
  }

  function clearNetworkDebug() {
    state.networkDebug = [];
    renderNetworkDebug();
    logEvent("Debug cleared.", "warn");
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
    els.continueButton.disabled = state.mode === "p2p" && !app.netcode.isChannelOpen();
    els.resultOverlay.hidden = false;
  }

  function resultText() {
    var game = state.game;

    if (!game) {
      return { title: "Round over", body: "The field is quiet.", won: false };
    }

    var localWon = state.mode === "local" ? true : game.winnerId === app.game.localRole();
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
    for (var index = 0; index < app.config.tileCount; index += 1) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "cell";
      button.disabled = true;
      button.setAttribute("role", "gridcell");
      button.setAttribute("aria-label", "Closed tile");
      els.board.appendChild(button);
    }
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

  app.ui = {
    cacheElements: cacheElements,
    bindEvents: bindEvents,
    buildEmptyBoard: buildEmptyBoard,
    logEvent: logEvent,
    renderNetworkDebug: renderNetworkDebug,
    formatNetworkDebug: formatNetworkDebug,
    pulseDice: pulseDice,
    render: render
  };
})(window.MineRollDuel = window.MineRollDuel || {});