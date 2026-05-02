(function (app) {
  "use strict";

  var state = app.state;

  async function startLocalDuel() {
    app.netcode.resetNetwork(true);
    state.mode = "local";
    state.roundId += 1;

    var localSeed = await app.utils.sha256("local|" + app.utils.randomHex(32) + "|" + Date.now());
    startGame(localSeed, "local");
    app.ui.logEvent("Local duel started.", "good");
  }

  function startGame(roundSeed, mode) {
    var board = app.rules.createBoard(roundSeed);
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
      activeIndex: app.utils.hash32(roundSeed + ":start") % 2,
      turnNumber: 0,
      awaitingRoll: true,
      rollValue: null,
      opensRemaining: 0,
      opened: new Array(app.config.tileCount).fill(false),
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
    app.ui.logEvent(activePlayer().name + " starts.", "warn");
    app.ui.render();
  }

  function rollDie() {
    var game = state.game;

    if (!game || !canUseTurnControls() || !game.awaitingRoll) {
      return;
    }

    var roll = app.rules.rollForTurn(game.roundSeed, game.turnNumber);
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
      app.ui.logEvent("Ignored out-of-turn move.", "warn");
      return false;
    }

    if (action.type === "roll") {
      return applyRollAction(action);
    }

    if (action.type === "open") {
      return applyOpenAction(action);
    }

    return false;
  }

  function applyRollAction(action) {
    var game = state.game;

    if (!game.awaitingRoll) {
      return false;
    }

    var expectedRoll = app.rules.rollForTurn(game.roundSeed, game.turnNumber);

    if (action.roll !== expectedRoll) {
      app.ui.logEvent("Ignored mismatched roll.", "bad");
      return false;
    }

    game.rollValue = action.roll;
    game.opensRemaining = action.roll;
    game.awaitingRoll = false;
    app.ui.pulseDice();
    app.ui.logEvent(activePlayer().name + " rolled " + action.roll + ".");
    app.ui.render();
    return true;
  }

  function applyOpenAction(action) {
    var game = state.game;

    if (game.awaitingRoll || game.opensRemaining <= 0 || !app.utils.isValidTile(action.index) || game.opened[action.index]) {
      return false;
    }

    openTile(action.index);
    app.ui.render();
    return true;
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
      app.ui.logEvent(player.name + " hit a bomb.", "bad");
      return;
    }

    game.safeOpened += 1;
    game.opensRemaining -= 1;
    app.ui.logEvent(player.name + " opened " + app.utils.cellLabel(index) + ".");

    if (game.safeOpened >= app.config.tileCount - game.bombCount) {
      game.phase = "ended";
      game.winnerId = player.id;
      game.loserId = otherPlayer().id;
      game.endReason = "clear";
      app.ui.logEvent(player.name + " cleared the field.", "good");
      return;
    }

    if (game.opensRemaining === 0) {
      game.turnNumber += 1;
      game.activeIndex = game.activeIndex === 0 ? 1 : 0;
      game.awaitingRoll = true;
      game.rollValue = null;
      app.ui.logEvent(activePlayer().name + " is up.", "warn");
    }
  }

  function continueRound() {
    if (state.mode === "local") {
      startLocalDuel();
      return;
    }

    if (app.netcode.isChannelOpen()) {
      var nextRound = state.roundId + 1;
      app.netcode.sendMessage({ type: "newRound", roundId: nextRound });
      app.netcode.startSeedExchange(nextRound);
    }
  }

  function sendGameAction(action) {
    if (state.mode !== "p2p") {
      return;
    }

    app.netcode.sendMessage({ type: "gameAction", roundId: state.roundId, action: action });
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

    return activePlayer().id === localRole() && app.netcode.isChannelOpen();
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

  app.game = {
    startLocalDuel: startLocalDuel,
    startGame: startGame,
    rollDie: rollDie,
    handleBoardClick: handleBoardClick,
    receiveGameAction: receiveGameAction,
    continueRound: continueRound,
    activePlayer: activePlayer,
    otherPlayer: otherPlayer,
    canUseTurnControls: canUseTurnControls,
    localRole: localRole,
    nameForRole: nameForRole,
    syncPlayerNames: syncPlayerNames
  };
})(window.MineRollDuel = window.MineRollDuel || {});