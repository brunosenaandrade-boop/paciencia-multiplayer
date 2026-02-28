const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(path.join(__dirname, 'public')));

// Room management
const rooms = new Map();

function createRoom() {
  const id = Math.random().toString(36).substring(2, 8).toUpperCase();
  const seed = Math.floor(Math.random() * 2147483647);
  rooms.set(id, { seed, players: [], started: false, winner: null });
  return id;
}

wss.on('connection', (ws) => {
  let currentRoom = null;
  let playerIndex = -1;
  let playerName = '';

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);

      switch (msg.type) {
        case 'create_room': {
          const roomId = createRoom();
          currentRoom = roomId;
          playerIndex = 0;
          playerName = msg.name || 'Jogador 1';
          const room = rooms.get(roomId);
          room.players.push({ ws, name: playerName, ready: false, progress: 0, moves: 0 });
          ws.send(JSON.stringify({
            type: 'room_created',
            roomId,
            seed: room.seed,
            playerIndex: 0
          }));
          break;
        }

        case 'join_room': {
          const roomId = msg.roomId.toUpperCase();
          const room = rooms.get(roomId);
          if (!room) {
            ws.send(JSON.stringify({ type: 'error', message: 'Sala não encontrada' }));
            return;
          }
          if (room.players.length >= 2) {
            ws.send(JSON.stringify({ type: 'error', message: 'Sala cheia' }));
            return;
          }
          currentRoom = roomId;
          playerIndex = room.players.length;
          playerName = msg.name || 'Jogador 2';
          room.players.push({ ws, name: playerName, ready: false, progress: 0, moves: 0 });
          ws.send(JSON.stringify({
            type: 'room_joined',
            roomId,
            seed: room.seed,
            playerIndex,
            opponentName: room.players[0].name
          }));
          // Notify host
          room.players[0].ws.send(JSON.stringify({
            type: 'opponent_joined',
            opponentName: playerName
          }));
          break;
        }

        case 'ready': {
          if (!currentRoom) return;
          const room = rooms.get(currentRoom);
          if (!room) return;
          room.players[playerIndex].ready = true;
          // Notify other player
          const allReady = room.players.length === 2 && room.players.every(p => p.ready);
          room.players.forEach((p, i) => {
            if (i !== playerIndex) {
              p.ws.send(JSON.stringify({ type: 'opponent_ready' }));
            }
          });
          if (allReady) {
            room.started = true;
            room.startTime = Date.now();
            room.players.forEach(p => {
              p.ws.send(JSON.stringify({ type: 'game_start' }));
            });
          }
          break;
        }

        case 'progress': {
          if (!currentRoom) return;
          const room = rooms.get(currentRoom);
          if (!room) return;
          room.players[playerIndex].progress = msg.foundation;
          room.players[playerIndex].moves = msg.moves;
          // Send to opponent
          room.players.forEach((p, i) => {
            if (i !== playerIndex) {
              p.ws.send(JSON.stringify({
                type: 'opponent_progress',
                foundation: msg.foundation,
                moves: msg.moves
              }));
            }
          });
          break;
        }

        case 'win': {
          if (!currentRoom) return;
          const room = rooms.get(currentRoom);
          if (!room || room.winner !== null) return;
          room.winner = playerIndex;
          const elapsed = ((Date.now() - room.startTime) / 1000).toFixed(1);
          room.players.forEach((p, i) => {
            p.ws.send(JSON.stringify({
              type: 'game_over',
              winner: playerIndex,
              winnerName: playerName,
              time: elapsed,
              moves: msg.moves
            }));
          });
          break;
        }

        case 'new_game': {
          if (!currentRoom) return;
          const room = rooms.get(currentRoom);
          if (!room) return;
          room.seed = Math.floor(Math.random() * 2147483647);
          room.started = false;
          room.winner = null;
          room.players.forEach(p => { p.ready = false; p.progress = 0; p.moves = 0; });
          room.players.forEach(p => {
            p.ws.send(JSON.stringify({
              type: 'new_game',
              seed: room.seed
            }));
          });
          break;
        }
      }
    } catch (e) {
      console.error('Error:', e);
    }
  });

  ws.on('close', () => {
    if (currentRoom) {
      const room = rooms.get(currentRoom);
      if (room) {
        room.players.forEach((p, i) => {
          if (i !== playerIndex && p.ws.readyState === 1) {
            p.ws.send(JSON.stringify({ type: 'opponent_disconnected' }));
          }
        });
        room.players = room.players.filter((_, i) => i !== playerIndex);
        if (room.players.length === 0) rooms.delete(currentRoom);
      }
    }
  });
});

const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
  const nets = require('os').networkInterfaces();
  let localIP = 'localhost';
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        localIP = net.address;
        break;
      }
    }
  }
  console.log(`\n  Paciencia Multiplayer rodando!`);
  console.log(`  Local:  http://localhost:${PORT}`);
  console.log(`  Rede:   http://${localIP}:${PORT}\n`);
});
