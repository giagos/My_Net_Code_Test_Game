(function (app) {
  "use strict";

  app.dom = {};

  app.state = {
    mode: null,
    selectedPane: "host",
    roundId: 0,
    log: [],
    networkDebug: [],
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
})(window.MineRollDuel = window.MineRollDuel || {});