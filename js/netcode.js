(function (app) {
  "use strict";

  var state = app.state;
  var acceptingAnswer = false;
  var debugEntryLimit = 160;

  async function createHostInvite() {
    try {
      ensureWebRtcSupport();
      resetNetwork(false);
      debugNetwork("Host setup", "Starting fresh WebRTC offer.");
      debugNetwork("WebRTC support", "RTCPeerConnection is available.", "good");
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
      debugNetwork("DataChannel", "Host created channel label=mine-roll-duel ordered=true.");
      wireDataChannel(channel);

      // Offer/answer is the manual signaling step. The offer text is copied by
      // the host and pasted by the guest; no matchmaking server is involved.
      var offer = await pc.createOffer();
      debugNetwork("SDP offer", "Created local offer.");
      await pc.setLocalDescription(offer);
      debugNetwork("SDP offer", "Local offer set; signaling=" + pc.signalingState + ".");
      await waitForIceGathering(pc);

      app.dom.inviteCode.value = app.utils.encodePayload({
        app: "MineRollDuel",
        version: app.config.version,
        type: "offer",
        description: pc.localDescription
      });
      debugNetwork("Invite code", "Ready; chars=" + app.dom.inviteCode.value.length + ", " + summarizeSdp(pc.localDescription) + ".", "good");

      state.connection.status = "invite-ready";
      app.ui.logEvent("Invite created.", "good");
      app.ui.render();
    } catch (error) {
      showNetworkError(error);
    }
  }

  async function acceptAnswer() {
    if (acceptingAnswer) {
      debugNetwork("Host answer", "Ignored duplicate click while answer is being accepted.", "warn");
      app.ui.logEvent("Answer is already being accepted.", "warn");
      app.ui.render();
      return;
    }

    try {
      var pc = state.connection.pc;
      debugNetwork("Host answer", "Connect clicked; signaling=" + (pc ? pc.signalingState : "none") + ".");

      if (!pc) {
        throw new Error("Create an invite first.");
      }

      if (pc.signalingState === "stable" && pc.remoteDescription) {
        debugNetwork("Host answer", "Answer was already accepted; signaling=stable.", "warn");
        app.ui.logEvent("Answer already accepted.", "warn");
        app.ui.render();
        return;
      }

      if (pc.signalingState !== "have-local-offer") {
        throw new Error("Create a fresh invite before accepting this answer.");
      }

      var payload = app.utils.decodePayload(app.dom.hostAnswerCode.value);
      assertPayload(payload, "answer");
      debugNetwork("SDP answer", "Decoded answer; " + summarizeSdp(payload.description) + ".");

      acceptingAnswer = true;
      state.connection.status = "connecting";
      state.connection.error = "";
      app.ui.render();

      // Setting the remote answer completes WebRTC negotiation on the host side.
      await pc.setRemoteDescription(payload.description);
      debugNetwork("SDP answer", "Remote answer set; signaling=" + pc.signalingState + ".", "good");
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
      debugNetwork("Join setup", "Invite decoded; " + summarizeSdp(offerPayload.description) + ".");
      debugNetwork("WebRTC support", "RTCPeerConnection is available.", "good");
      app.dom.answerCode.value = "";
      state.mode = "p2p";
      state.connection.role = "guest";
      state.connection.status = "creating";
      state.connection.error = "";
      app.ui.render();

      var pc = createPeerConnection();
      state.connection.pc = pc;

      pc.addEventListener("datachannel", function (event) {
        debugNetwork("DataChannel", "Guest received remote channel label=" + event.channel.label + ".");
        wireDataChannel(event.channel);
      });

      // The guest applies the host offer, creates an answer, then gives that
      // answer back to the host through the textarea copy/paste flow.
      await pc.setRemoteDescription(offerPayload.description);
      debugNetwork("SDP offer", "Remote offer set; signaling=" + pc.signalingState + ".");
      var answer = await pc.createAnswer();
      debugNetwork("SDP answer", "Created local answer.");
      await pc.setLocalDescription(answer);
      debugNetwork("SDP answer", "Local answer set; signaling=" + pc.signalingState + ".");
      await waitForIceGathering(pc);

      app.dom.answerCode.value = app.utils.encodePayload({
        app: "MineRollDuel",
        version: app.config.version,
        type: "answer",
        description: pc.localDescription
      });
      debugNetwork("Answer code", "Ready; chars=" + app.dom.answerCode.value.length + ", " + summarizeSdp(pc.localDescription) + ".", "good");

      state.connection.status = "answer-ready";
      app.ui.logEvent("Answer created.", "good");
      app.ui.render();
    } catch (error) {
      showNetworkError(error);
    }
  }

  function createPeerConnection() {
    var pc = new RTCPeerConnection({ iceServers: app.config.iceServers });
    pc._candidateCounts = { host: 0, srflx: 0, relay: 0, prflx: 0, unknown: 0 };

    debugNetwork("RTCPeerConnection", "Created with ICE servers: " + describeIceServers() + ".");

    if (!hasTurnServer()) {
      debugNetwork("TURN relay", "No TURN server configured; strict NAT/firewalls may never link.", "warn");
    }

    pc.addEventListener("signalingstatechange", function () {
      debugNetwork("Signaling state", pc.signalingState + ".");
    });

    pc.addEventListener("icegatheringstatechange", function () {
      debugNetwork("ICE gathering", pc.iceGatheringState + "; " + formatCandidateCounts(pc) + ".");
    });

    pc.addEventListener("icecandidate", function (event) {
      if (!event.candidate) {
        debugNetwork("ICE candidate", "Browser reported end of candidates; " + formatCandidateCounts(pc) + ".", "good");
        return;
      }

      countCandidate(pc, event.candidate);
      debugNetwork("ICE candidate", summarizeCandidate(event.candidate) + "; " + formatCandidateCounts(pc) + ".");
    });

    pc.addEventListener("icecandidateerror", function (event) {
      debugNetwork("ICE server error", summarizeIceCandidateError(event), "bad");
    });

    pc.addEventListener("connectionstatechange", function () {
      var status = pc.connectionState;
      debugNetwork("Peer connection", "connectionState=" + status + ".", status === "connected" ? "good" : status === "failed" ? "bad" : "");

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
      debugNetwork("ICE connection", "iceConnectionState=" + pc.iceConnectionState + ".", pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed" ? "good" : pc.iceConnectionState === "failed" ? "bad" : "");

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
    debugNetwork("DataChannel", "Wired label=" + channel.label + ", readyState=" + channel.readyState + ".");

    channel.addEventListener("open", function () {
      state.connection.status = "connected";
      state.connection.error = "";
      debugNetwork("DataChannel", "Open; readyState=" + channel.readyState + ".", "good");
      sendMessage({ type: "hello", name: state.connection.localName, version: app.config.version });
      app.ui.logEvent("Encrypted peer link open.", "good");

      // Once the encrypted channel is open, both peers start a fresh seed
      // exchange. The seed exchange is what makes both browsers build the same
      // board and dice rolls without either side secretly choosing the outcome.
      startSeedExchange(state.roundId + 1);
      app.ui.render();
    });

    channel.addEventListener("message", function (event) {
      debugNetwork("DataChannel", "Received raw message; chars=" + String(event.data || "").length + ".");
      handleMessage(event.data);
    });

    channel.addEventListener("close", function () {
      state.connection.status = "closed";
      debugNetwork("DataChannel", "Closed.", "warn");
      app.ui.logEvent("Peer link closed.", "warn");
      app.ui.render();
    });

    channel.addEventListener("error", function () {
      state.connection.status = "failed";
      state.connection.error = "Data channel error.";
      debugNetwork("DataChannel", "Error event fired.", "bad");
      app.ui.logEvent("Data channel error.", "bad");
      app.ui.render();
    });
  }

  async function waitForIceGathering(pc) {
    if (pc.iceGatheringState === "complete") {
      debugNetwork("ICE gathering", "Already complete; " + formatCandidateCounts(pc) + ".", "good");
      return;
    }

    debugNetwork("ICE gathering", "Waiting for local candidates; state=" + pc.iceGatheringState + ".");

    await new Promise(function (resolve) {
      var done = false;
      var timeoutId = window.setTimeout(function () {
        finish("Timed out after 6500ms; continuing with gathered candidates.", "warn");
      }, 6500);

      function finish(reason, tone) {
        if (done) {
          return;
        }

        done = true;
        window.clearTimeout(timeoutId);
        pc.removeEventListener("icegatheringstatechange", checkState);
        pc.removeEventListener("icecandidate", checkCandidate);
        debugNetwork("ICE gathering", reason + " " + formatCandidateCounts(pc) + ".", tone || "");
        resolve();
      }

      function checkState() {
        if (pc.iceGatheringState === "complete") {
          finish("Complete.", "good");
        }
      }

      function checkCandidate(event) {
        if (!event.candidate) {
          finish("End-of-candidates event received.", "good");
        }
      }

      pc.addEventListener("icegatheringstatechange", checkState);
      pc.addEventListener("icecandidate", checkCandidate);
    });
  }

  async function startSeedExchange(roundId) {
    debugNetwork("Seed exchange", "Starting round " + roundId + ".");
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
    debugNetwork("Seed commit", "Local commit ready for round " + roundId + "; commitPrefix=" + state.seedExchange.localCommit.slice(0, 12) + ".");

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
      debugNetwork("Peer message", "Unreadable JSON from peer.", "bad");
      app.ui.logEvent("Unreadable peer message.", "bad");
      return;
    }

    if (!message || typeof message.type !== "string") {
      debugNetwork("Peer message", "Ignored message without a type.", "warn");
      return;
    }

    debugNetwork("Peer message", "Received " + summarizeMessage(message) + ".");

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
      debugNetwork("Seed commit", "Commit arrived for round " + message.roundId + "; starting matching exchange.", "warn");
      await startSeedExchange(message.roundId);
    }

    state.connection.remoteName = app.utils.cleanName(message.name || state.connection.remoteName);
    state.seedExchange.remoteCommit = String(message.commit || "");
    debugNetwork("Seed commit", "Remote commit stored for round " + message.roundId + "; commitPrefix=" + state.seedExchange.remoteCommit.slice(0, 12) + ".");

    if (state.seedExchange.pendingReveal) {
      debugNetwork("Seed reveal", "Pending reveal can now be checked.");
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
      debugNetwork("Seed reveal", "Remote reveal arrived before commit; stored pending reveal.", "warn");
      return;
    }

    var seed = String(message.seed || "");
    var commit = await app.utils.sha256(seed);

    if (commit !== state.seedExchange.remoteCommit) {
      state.connection.status = "failed";
      state.connection.error = "Seed check failed.";
      debugNetwork("Seed reveal", "Remote seed hash did not match commit.", "bad");
      app.ui.logEvent("Seed check failed.", "bad");
      app.ui.render();
      return;
    }

    state.seedExchange.remoteSeed = seed;
    debugNetwork("Seed reveal", "Remote seed verified for round " + message.roundId + ".", "good");
    await maybeStartSharedGame();
  }

  function maybeRevealSeed() {
    var exchange = state.seedExchange;

    if (!exchange || !exchange.localCommit || !exchange.remoteCommit || exchange.localRevealSent) {
      return;
    }

    exchange.localRevealSent = true;
    debugNetwork("Seed reveal", "Sending local reveal for round " + exchange.roundId + ".");
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
    debugNetwork("Seed exchange", "Shared round seed ready for round " + exchange.roundId + ".", "good");

    app.game.startGame(roundSeed, "p2p");
  }

  function sendMessage(message) {
    if (!isChannelOpen()) {
      debugNetwork("Peer message", "Send skipped; channelState=" + channelState() + "; " + summarizeMessage(message) + ".", "warn");
      return false;
    }

    var payload = JSON.stringify(message);
    state.connection.channel.send(payload);
    debugNetwork("Peer message", "Sent " + summarizeMessage(message) + "; chars=" + payload.length + ".");
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
      state.networkDebug = [];
    }

    debugNetwork("Network reset", keepLog ? "Closed peer objects and kept log." : "Fresh network attempt.");

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

  function debugNetwork(topic, detail, tone) {
    var time = new Date().toLocaleTimeString([], {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });

    state.networkDebug.unshift({
      time: time,
      role: state.connection.role || "none",
      topic: topic,
      detail: detail || "",
      tone: tone || ""
    });
    state.networkDebug = state.networkDebug.slice(0, debugEntryLimit);

    if (app.ui && app.ui.renderNetworkDebug) {
      app.ui.renderNetworkDebug();
    }
  }

  function describeIceServers() {
    if (!app.config.iceServers.length) {
      return "none";
    }

    return app.config.iceServers.map(function (server) {
      var urls = Array.isArray(server.urls) ? server.urls : [server.urls];
      return urls.join(", ");
    }).join(" | ");
  }

  function hasTurnServer() {
    return app.config.iceServers.some(function (server) {
      var urls = Array.isArray(server.urls) ? server.urls : [server.urls];
      return urls.some(function (url) {
        return String(url || "").toLowerCase().indexOf("turn:") === 0 || String(url || "").toLowerCase().indexOf("turns:") === 0;
      });
    });
  }

  function countCandidate(pc, candidate) {
    var type = candidate.type || candidateValue(candidate.candidate, "typ") || "unknown";
    var counts = pc._candidateCounts;

    if (!counts[type]) {
      counts[type] = 0;
    }

    counts[type] += 1;
  }

  function formatCandidateCounts(pc) {
    var counts = pc._candidateCounts || { host: 0, srflx: 0, relay: 0, prflx: 0, unknown: 0 };
    return "candidates host=" + (counts.host || 0) + ", srflx=" + (counts.srflx || 0) + ", relay=" + (counts.relay || 0) + ", prflx=" + (counts.prflx || 0) + ", unknown=" + (counts.unknown || 0);
  }

  function summarizeCandidate(candidate) {
    var type = candidate.type || candidateValue(candidate.candidate, "typ") || "unknown";
    var protocol = candidate.protocol || candidatePart(candidate.candidate, 2) || "unknown";
    var address = candidate.address || candidatePart(candidate.candidate, 4) || "unknown-address";
    var port = candidate.port || candidatePart(candidate.candidate, 5) || "unknown-port";
    var related = candidate.relatedAddress ? ", related=" + candidate.relatedAddress + ":" + candidate.relatedPort : "";

    return "type=" + type + ", protocol=" + String(protocol).toUpperCase() + ", address=" + address + ":" + port + related;
  }

  function summarizeIceCandidateError(event) {
    var parts = ["url=" + (event.url || "unknown")];

    if (event.errorCode) {
      parts.push("code=" + event.errorCode);
    }

    if (event.errorText) {
      parts.push("text=" + event.errorText);
    }

    if (event.address || event.port) {
      parts.push("address=" + (event.address || "unknown") + ":" + (event.port || "unknown"));
    }

    return parts.join(", ") + ".";
  }

  function candidatePart(candidateLine, index) {
    var parts = String(candidateLine || "").split(/\s+/);
    return parts[index] || "";
  }

  function candidateValue(candidateLine, key) {
    var parts = String(candidateLine || "").split(/\s+/);
    var keyIndex = parts.indexOf(key);

    if (keyIndex === -1 || keyIndex + 1 >= parts.length) {
      return "";
    }

    return parts[keyIndex + 1];
  }

  function summarizeSdp(description) {
    if (!description || !description.sdp) {
      return "no SDP";
    }

    var candidateCount = description.sdp.split("\na=candidate:").length - 1;
    return "type=" + description.type + ", sdpChars=" + description.sdp.length + ", sdpCandidates=" + candidateCount;
  }

  function summarizeMessage(message) {
    if (!message || !message.type) {
      return "message without type";
    }

    if (message.type === "gameAction" && message.action) {
      return "gameAction:" + message.action.type + " round=" + message.roundId + " turn=" + message.action.turnNumber;
    }

    if (typeof message.roundId === "number") {
      return message.type + " round=" + message.roundId;
    }

    return message.type;
  }

  function channelState() {
    return state.connection.channel ? state.connection.channel.readyState : "none";
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
    debugNetwork("Network error", state.connection.error, "bad");
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