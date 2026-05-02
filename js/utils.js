(function (app) {
  "use strict";

  function cleanName(value) {
    var name = String(value || "").trim().replace(/\s+/g, " ");
    return name || "Player";
  }

  function titleCase(value) {
    return value.slice(0, 1).toUpperCase() + value.slice(1);
  }

  function cellLabel(index) {
    var gridSize = app.config.gridSize;
    return String.fromCharCode(65 + Math.floor(index / gridSize)) + String((index % gridSize) + 1);
  }

  function isValidTile(index) {
    return Number.isInteger(index) && index >= 0 && index < app.config.tileCount;
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

    for (var index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }

    return JSON.parse(new TextDecoder().decode(bytes));
  }

  async function copyText(textarea) {
    var text = textarea.value;

    if (!text) {
      return false;
    }

    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }

    textarea.focus();
    textarea.select();
    return document.execCommand("copy");
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

  app.utils = {
    cleanName: cleanName,
    titleCase: titleCase,
    cellLabel: cellLabel,
    isValidTile: isValidTile,
    encodePayload: encodePayload,
    decodePayload: decodePayload,
    copyText: copyText,
    randomHex: randomHex,
    sha256: sha256,
    hash32: hash32,
    mulberry32: mulberry32
  };
})(window.MineRollDuel = window.MineRollDuel || {});