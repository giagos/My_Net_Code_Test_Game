(function (app) {
  "use strict";

  function createBoard(seed) {
    var tileCount = app.config.tileCount;
    var rng = app.utils.mulberry32(app.utils.hash32(seed + ":board"));
    var bombCount = 1 + Math.floor(rng() * 6);
    var indices = [];
    var bombs = new Set();
    var adjacency = new Array(tileCount).fill(0);

    for (var index = 0; index < tileCount; index += 1) {
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

    for (var tile = 0; tile < tileCount; tile += 1) {
      if (!bombs.has(tile)) {
        adjacency[tile] = neighbors(tile).filter(function (neighbor) {
          return bombs.has(neighbor);
        }).length;
      }
    }

    return { bombs: bombs, adjacency: adjacency };
  }

  function neighbors(index) {
    var gridSize = app.config.gridSize;
    var row = Math.floor(index / gridSize);
    var col = index % gridSize;
    var result = [];

    for (var rowStep = -1; rowStep <= 1; rowStep += 1) {
      for (var colStep = -1; colStep <= 1; colStep += 1) {
        if (rowStep !== 0 || colStep !== 0) {
          var nextRow = row + rowStep;
          var nextCol = col + colStep;

          if (nextRow >= 0 && nextRow < gridSize && nextCol >= 0 && nextCol < gridSize) {
            result.push(nextRow * gridSize + nextCol);
          }
        }
      }
    }

    return result;
  }

  function rollForTurn(seed, turnNumber) {
    return (app.utils.hash32(seed + ":roll:" + turnNumber) % 6) + 1;
  }

  app.rules = {
    createBoard: createBoard,
    rollForTurn: rollForTurn
  };
})(window.MineRollDuel = window.MineRollDuel || {});