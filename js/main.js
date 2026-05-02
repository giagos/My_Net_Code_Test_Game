(function (app) {
  "use strict";

  document.addEventListener("DOMContentLoaded", function () {
    app.ui.cacheElements();
    app.ui.bindEvents();
    app.ui.buildEmptyBoard();
    app.ui.logEvent("Ready.");
    app.ui.render();
  });
})(window.MineRollDuel = window.MineRollDuel || {});