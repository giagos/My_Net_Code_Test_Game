(function (app) {
  "use strict";

  var gridSize = 7;

  app.config = Object.freeze({
    version: "0.1.0",
    gridSize: gridSize,
    tileCount: gridSize * gridSize,

    // STUN servers only help peers discover usable network routes. They do not
    // relay game traffic and they do not host the game state.
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" }
    ]
  });
})(window.MineRollDuel = window.MineRollDuel || {});