(function (app) {
  "use strict";

  var state = app.state;
  var acceptingAnswer = false;

  async function createHostInvite() {
    try {
      ensureWebRtcSupport();
      resetNetwork(false);
      app.dom.inviteCode.value = "";
      app.dom.hostAnswerCode.value = "";
      state.mode = "p2p";
      state.connection.role = "host";
      state.connection.status = "creating";
      state.connection.error = "";
      app.ui.render();

      var pc = createPeerConnection();
      state.connection.pc = pc;

      // The host creates the data channel up front. The guest receives the same
      // channel through RTCPeerConnection's datachannel event after accepting the offer.
      var channel = pc.createDataChannel("mine-roll-duel", { ordered: true });
      wireDataChannel(channel);

      // Offer/answer is the manual signaling step. The offer text is copied by
      // the host and pasted by the guest; no matchmaking server is involved.
      var offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitForIceGathering(pc);

      app.dom.inviteCode.value = app.utils.encodePayload({
        app: "MineRollDuel",
        version: app.config.version,
        type: "offer",
        description: pc.localDescription
      });

      state.connection.status = "invite-ready";
      app.ui.logEvent("Invite created.", "good");
      app.ui.render();
    } catch (error) {
      showNetworkError(error);
    }
  }

  async function acceptAnswer() {
    if (acceptingAnswer) {
      app.ui.logEvent("Answer is already being accepted.", "warn");
      app.ui.render();
      return;
    }

    try {
      var pc = state.connection.pc;

      if (!pc) {
        throw new Error("Create an invite first.");
      }

      if (pc.signalingState === "stable" && pc.remoteDescription) {
        app.ui.logEvent("Answer already accepted.", "warn");
        app.ui.render();
        return;
      }

      if (pc.signalingState !== "have-local-offer") {
        throw new Error("Create a fresh invite before accepting this answer.");
      }

      var payload = app.utils.decodePayload(app.dom.hostAnswerCode.value);
      assertPayload(payload, "answer");

      acceptingAnswer = true;
      state.connection.status = "connecting";
      state.connection.error = "";
      app.ui.render();

      // Setting the remote answer completes WebRTC negotiation on the host side.
      await pc.setRemoteDescription(payload.description);
      app.ui.logEvent("Answer accepted.", "good");
      app.ui.render();
    } catch (error) {
      showNetworkError(error);
    } finally {
      acceptingAnswer = false;
    }
  }

  async function createJoinAnswer() {
    try {
      ensureWebRtcSupport();
      var offerPayload = app.utils.decodePayload(app.dom.joinInviteCode.value);
      assertPayload(offerPayload, "offer");

      resetNetwork(false);
      app.dom.answerCode.value = "";
      state.mode = "p2p";
      state.connection.role = "guest";
      state.connection.status = "creating";
      state.connection.error = "";
      app.ui.render();

      var pc = createPeerConnection();
      state.connection.pc = pc;

      pc.addEventListener("datachannel", function (event) {
        wireDataChannel(event.channel);
      });

      // The guest applies the host offer, creates an answer, then gives that
      // answer back to the host through the textarea copy/paste flow.
      await pc.setRemoteDescription(offerPayload.description);
      var answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await waitForIceGathering(pc);

      app.dom.answerCode.value = app.utils.encodePayload({
        app: "MineRollDuel",
        version: app.config.version,
        type: "answer",
        description: pc.localDescription
      });

      state.connection.status = "answer-ready";
      app.ui.logEvent("Answer created.", "good");
      app.ui.render();
    } catch (error) {
      showNetworkError(error);
    }
  }

  function createPeerConnection() {
    var pc = new RTCPeerConnection({ iceServers: app.config.iceServers });

    pc.addEventListener("connectionstatechange", function () {
      var status = pc.connectionState;

      if (status === "connected") {
        state.connection.status = "connected";
      } else if (status === "connecting") {
        state.connection.status = "connecting";
      } else if (status === "failed" || status === "disconnected" || status === "closed") {
        state.connection.status = status;
      }

      app.ui.render();
    });

    pc.addEventListener("iceconnectionstatechange", function () {
      if (pc.iceConnectionState === "failed") {
        state.connection.status = "failed";
        state.connection.error = "Peer route failed.";
        app.ui.logEvent("Peer route failed.", "bad");
        app.ui.render();
      }
    });

    return pc;
  }

  function wireDataChannel(channel) {
    state.connection.channel = channel;

    channel.addEventListener("open", function () {
      state.connection.status = "connected";
      state.connection.error = "";
      sendMessage({ type: "hello", name: state.connection.localName, version: app.config.version });
      app.ui.logEvent("Encrypted peer link open.", "good");

      // Once the encrypted channel is open, both peers start a fresh seed
      // exchange. The seed exchange is what makes both browsers build the same
      // board and dice rolls without either side secretly choosing the outcome.
      startSeedExchange(state.roundId + 1);
      app.ui.render();
    });

    channel.addEventListener("message", function (event) {
      handleMessage(event.data);
    });

    channel.addEventListener("close", function () {
      state.connection.status = "closed";
      app.ui.logEvent("Peer link closed.", "warn");
      app.ui.render();
    });

    channel.addEventListener("error", function () {
      state.connection.status = "failed";
      state.connection.error = "Data channel error.";
      app.ui.logEvent("Data channel error.", "bad");
      app.ui.render();
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
      localSeed: app.utils.randomHex(32),
      localCommit: "",
      localRevealSent: false,
      remoteCommit: "",
      remoteSeed: "",
      pendingReveal: "",
      started: false
    };
    state.game = null;
    app.ui.buildEmptyBoard();

    // Commit/reveal in plain language:
    // 1. Each browser creates a private random seed.
    // 2. Each browser sends only a SHA-256 hash of that seed first.
    // 3. After both hashes are locked in, each browser reveals its seed.
    // 4. Each browser hashes the revealed seed and checks it matches the commit.
    // 5. The two verified seeds are combined to generate the shared round.
    state.seedExchange.localCommit = await app.utils.sha256(state.seedExchange.localSeed);

    sendMessage({
      type: "seedCommit",
      roundId: roundId,
      role: state.connection.role,
      name: state.connection.localName,
      commit: state.seedExchange.localCommit
    });

    app.ui.logEvent("Round seed locked.", "good");
    maybeRevealSeed();
    app.ui.render();
  }

  async function handleMessage(raw) {
    var message;

    try {
      message = JSON.parse(raw);
    } catch (error) {
      app.ui.logEvent("Unreadable peer message.", "bad");
      return;
    }

    if (!message || typeof message.type !== "string") {
      return;
    }

    if (message.type === "hello") {
      state.connection.remoteName = app.utils.cleanName(message.name || "Opponent");
      app.game.syncPlayerNames();
      app.ui.render();
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
      app.game.receiveGameAction(message);
      return;
    }

    if (message.type === "newRound" && typeof message.roundId === "number" && message.roundId > state.roundId) {
      app.ui.logEvent("Next round accepted.", "good");
      startSeedExchange(message.roundId);
    }
  }

  async function receiveSeedCommit(message) {
    if (!state.seedExchange || state.seedExchange.roundId !== message.roundId) {
      await startSeedExchange(message.roundId);
    }

    state.connection.remoteName = app.utils.cleanName(message.name || state.connection.remoteName);
    state.seedExchange.remoteCommit = String(message.commit || "");

    if (state.seedExchange.pendingReveal) {
      await receiveSeedReveal({ roundId: message.roundId, seed: state.seedExchange.pendingReveal });
      state.seedExchange.pendingReveal = "";
      return;
    }

    maybeRevealSeed();
    app.ui.render();
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
    var commit = await app.utils.sha256(seed);

    if (commit !== state.seedExchange.remoteCommit) {
      state.connection.status = "failed";
      state.connection.error = "Seed check failed.";
      app.ui.logEvent("Seed check failed.", "bad");
      app.ui.render();
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
    sendMessage({ type: "seedReveal", roundId: exchange.roundId, seed: exchange.localSeed });
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
    var roundSeed = await app.utils.sha256("mine-roll-duel|" + exchange.roundId + "|host:" + hostSeed + "|guest:" + guestSeed);

    app.game.startGame(roundSeed, "p2p");
  }

  function sendMessage(message) {
    if (!isChannelOpen()) {
      return false;
    }

    state.connection.channel.send(JSON.stringify(message));
    return true;
  }

  function resetNetwork(keepLog) {
    acceptingAnswer = false;

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

    app.ui.buildEmptyBoard();
  }

  function isChannelOpen() {
    return Boolean(state.connection.channel && state.connection.channel.readyState === "open");
  }

  function canAcceptAnswer() {
    return Boolean(
      state.connection.pc &&
      !acceptingAnswer &&
      state.connection.pc.signalingState === "have-local-offer"
    );
  }

  function assertPayload(payload, expectedType) {
    if (!payload || payload.app !== "MineRollDuel" || payload.type !== expectedType || !payload.description) {
      throw new Error("That code is not a valid " + expectedType + ".");
    }
  }

  function ensureWebRtcSupport() {
    if (!window.RTCPeerConnection) {
      throw new Error("WebRTC is not available in this browser.");
    }
  }

  function showNetworkError(error) {
    state.connection.status = "failed";
    state.connection.error = error && error.message ? error.message : "Network setup failed.";
    app.ui.logEvent(state.connection.error, "bad");
    app.ui.render();
  }

  app.netcode = {
    createHostInvite: createHostInvite,
    acceptAnswer: acceptAnswer,
    createJoinAnswer: createJoinAnswer,
    startSeedExchange: startSeedExchange,
    sendMessage: sendMessage,
    resetNetwork: resetNetwork,
    isChannelOpen: isChannelOpen,
    canAcceptAnswer: canAcceptAnswer
  };
})(window.MineRollDuel = window.MineRollDuel || {});