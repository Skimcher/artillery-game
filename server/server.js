const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Serve client files
app.use(express.static(path.join(__dirname, '../client')));

// Game state
const waitingPlayers = [];
const games = new Map();
let gameIdCounter = 0;

const TURN_TIME = 5000; // 5 seconds
const GRID_SIZE = 8;    // 8x8 grid per side

function createGame(player1, player2) {
  const gameId = ++gameIdCounter;

  const game = {
    id: gameId,
    players: [player1, player2],
    // Each player has 2 cannons at random positions on their side
    cannons: [
      [ { x: 2, y: 2 }, { x: 5, y: 5 } ], // player 0 cannons
      [ { x: 2, y: 2 }, { x: 5, y: 5 } ]  // player 1 cannons
    ],
    // Track cannon health: true = alive, false = destroyed
    cannonAlive: [
      [true, true],
      [true, true]
    ],
    currentTurn: 0, // index 0 or 1
    turnTimer: null,
    turnStartTime: null
  };

  games.set(gameId, game);
  player1.gameId = gameId;
  player1.playerIndex = 0;
  player2.gameId = gameId;
  player2.playerIndex = 1;

  // Send game start to both players
  sendToPlayer(player1, {
    type: 'game_start',
    playerIndex: 0,
    myCannons: game.cannons[0],
    enemyCannons: game.cannons[1],
    currentTurn: 0
  });

  sendToPlayer(player2, {
    type: 'game_start',
    playerIndex: 1,
    myCannons: game.cannons[1],
    enemyCannons: game.cannons[0],
    currentTurn: 0
  });

  startTurn(game);
  return game;
}

function startTurn(game) {
  game.turnStartTime = Date.now();

  // Notify both players whose turn it is
  game.players.forEach((p, i) => {
    sendToPlayer(p, {
      type: 'turn_start',
      yourTurn: i === game.currentTurn,
      timeLeft: TURN_TIME / 1000
    });
  });

  // Auto-end turn after timeout
  game.turnTimer = setTimeout(() => {
    endTurn(game, null);
  }, TURN_TIME);
}

function endTurn(game, action) {
  clearTimeout(game.turnTimer);

  const actingPlayer = game.currentTurn;
  const otherPlayer = 1 - actingPlayer;

  let result = { type: 'turn_result', action: null, hit: false, cannonIndex: -1 };

  if (action) {
    result.action = action;

    if (action.type === 'fire') {
      // Check if shot hits any enemy cannon
      const enemyCannons = game.cannons[otherPlayer];
      for (let i = 0; i < enemyCannons.length; i++) {
        if (game.cannonAlive[otherPlayer][i]) {
          const c = enemyCannons[i];
          if (c.x === action.x && c.y === action.y) {
            result.hit = true;
            result.cannonIndex = i;
            game.cannonAlive[otherPlayer][i] = false;
            break;
          }
        }
      }
    } else if (action.type === 'move') {
      // Move cannon
      const idx = action.cannonIndex;
      if (idx >= 0 && idx < 2 && game.cannonAlive[actingPlayer][idx]) {
        game.cannons[actingPlayer][idx] = { x: action.x, y: action.y };
      }
    }
  }

  // Check win condition
  const enemyAlive = game.cannonAlive[otherPlayer].some(a => a);
  if (!enemyAlive) {
    game.players.forEach((p, i) => {
      sendToPlayer(p, {
        type: 'game_over',
        winner: actingPlayer,
        youWin: i === actingPlayer
      });
    });
    games.delete(game.id);
    return;
  }

  // Send result to both players
  game.players.forEach((p, i) => {
    sendToPlayer(p, {
      ...result,
      // Moving player sees their updated cannon positions
      myCannons: game.cannons[i],
      enemyAlive: game.cannonAlive[1 - i]
    });
  });

  // Switch turn
  game.currentTurn = otherPlayer;
  setTimeout(() => startTurn(game), 500);
}

function sendToPlayer(player, data) {
  if (player && player.ws && player.ws.readyState === 1) {
    player.ws.send(JSON.stringify(data));
  }
}

wss.on('connection', (ws) => {
  const player = { ws, gameId: null, playerIndex: null };

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'find_game') {
      // Add to matchmaking queue
      waitingPlayers.push(player);
      sendToPlayer(player, { type: 'waiting' });

      if (waitingPlayers.length >= 2) {
        const p1 = waitingPlayers.shift();
        const p2 = waitingPlayers.shift();
        createGame(p1, p2);
      }
    }

    if (msg.type === 'action') {
      const game = games.get(player.gameId);
      if (!game) return;
      if (game.currentTurn !== player.playerIndex) return; // not your turn

      endTurn(game, msg.action);
    }
  });

  ws.on('close', () => {
    // Remove from waiting queue if still there
    const idx = waitingPlayers.indexOf(player);
    if (idx !== -1) waitingPlayers.splice(idx, 1);

    // Notify opponent if in game
    if (player.gameId) {
      const game = games.get(player.gameId);
      if (game) {
        clearTimeout(game.turnTimer);
        const other = game.players.find(p => p !== player);
        sendToPlayer(other, { type: 'opponent_left' });
        games.delete(player.gameId);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Artillery Game server running on port ${PORT}`);
});
