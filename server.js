const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};
const talkOrders = {};
const talkIndexes = {};

function emitLobbyUpdate(room) {
  if (!rooms[room]) return;
  io.in(room).emit('lobby_update', {
    room,
    players: rooms[room].players.map(p => p.name),
    hostName: rooms[room].hostName,
    impostors: rooms[room].impostors,
    suggestions: rooms[room].suggestions // <--- agrega sugerencias para el lobby
  });
}

io.on('connection', (socket) => {
  let currentRoom = null;
  let playerName = null;

  socket.on('join_room', ({ name, room, impostors }) => {
    playerName = name;
    currentRoom = room;
    if (!rooms[room]) {
      rooms[room] = {
        hostSocketId: socket.id,
        hostName: name,
        impostors: impostors || 1,
        players: [],
        suggestions: {},
        roles: {},
        eliminated: [],
        votes: {},
        secret: null
      };
    }
    // Si ya existe, actualiza socketId
    let existing = rooms[room].players.find(p => p.name === name);
    if (existing) {
      existing.socketId = socket.id;
    } else {
      rooms[room].players.push({ name, socketId: socket.id });
    }
    socket.join(room);
    emitLobbyUpdate(room);
  });

  socket.on('set_impostors', ({ room, impostors }) => {
    if (!rooms[room]) return;
    if (rooms[room].hostSocketId === socket.id) {
      rooms[room].impostors = Math.max(1, Math.min(3, Number(impostors)));
      emitLobbyUpdate(room);
    }
  });

  socket.on('suggest_secret', ({ suggestion, room }) => {
    if (!rooms[room]) return;
    rooms[room].suggestions[playerName] = suggestion;
    emitLobbyUpdate(room);
  });

  socket.on('start_game', ({ room }) => {
    if (!rooms[room]) return;
    if (rooms[room].hostSocketId !== socket.id) return;
    const sala = rooms[room];

    // RESET DE ELIMINADOS Y VOTOS
    sala.eliminated = [];
    sala.votes = {};

    // Asignar roles
    let playerCount = sala.players.length;
    let impostorCount = Math.max(1, Math.min(sala.impostors, playerCount - 1));
    let indices = Array.from(sala.players.keys()).sort(() => Math.random() - 0.5);
    const impostorIndices = indices.slice(0, impostorCount);

    sala.roles = {};
    sala.players.forEach((p, i) => {
      sala.roles[p.name] = impostorIndices.includes(i) ? 'impostor' : 'innocent';
    });

    // SOLO USAR SUGERENCIAS DE INOCENTES PARA EL SECRETO
    const innocentNames = sala.players.filter(p => sala.roles[p.name] === 'innocent').map(p => p.name);
    const innocentSuggestions = innocentNames
      .map(name => sala.suggestions[name])
      .filter(x => x && x.trim().length > 0);
    const secret = innocentSuggestions.length > 0
      ? innocentSuggestions[Math.floor(Math.random() * innocentSuggestions.length)]
      : "";

    sala.secret = secret;

    sala.players.forEach(p => {
      if (sala.roles[p.name] === 'impostor') {
        io.to(p.socketId).emit('role_assigned', { role: 'impostor' });
      } else {
        io.to(p.socketId).emit('role_assigned', { role: 'innocent', secret });
      }
    });

    // TURNO DE HABLAR: Impos y inocentes mezclados completamente
    const vivos = sala.players.map(p => p.name);
    let order = vivos.sort(() => Math.random() - 0.5);

    talkOrders[room] = order;
    talkIndexes[room] = 0;

    io.in(room).emit("start_talk", { order });
  });

  socket.on("done_talk", ({ room }) => {
    if (!rooms[room]) return;
    if (!talkOrders[room]) return;
    talkIndexes[room] = talkIndexes[room] + 1;
    const sala = rooms[room];
    if (talkIndexes[room] < talkOrders[room].length) {
      io.in(room).emit("next_talk", { index: talkIndexes[room] });
    } else {
      const vivos = sala.players
        .map(p => p.name)
        .filter(name => !sala.eliminated.includes(name));
      io.in(room).emit("to_vote", vivos, sala.eliminated);
      io.in(room).emit("votes_update", sala.votes, vivos.length, sala.eliminated, sala.roles);
    }
  });

  socket.on('vote', ({ target, room }) => {
    if (!rooms[room]) return;
    const sala = rooms[room];
    // Si el jugador está eliminado, ignora el voto
    if (sala.eliminated.includes(playerName)) return;
    sala.votes[playerName] = target;
    const vivos = sala.players
      .map(p => p.name)
      .filter(name => !sala.eliminated.includes(name));
    io.in(room).emit("votes_update", sala.votes, vivos.length, sala.eliminated, sala.roles);

    if (Object.keys(sala.votes).length >= vivos.length) {
      // Conteo de votos
      const votos = {};
      Object.values(sala.votes).forEach(targetName => {
        if (!votos[targetName]) votos[targetName] = 0;
        votos[targetName]++;
      });
      let max = 0, eliminados = [];
      for (let name in votos) {
        if (votos[name] > max) {
          max = votos[name];
          eliminados = [name];
        } else if (votos[name] === max) {
          eliminados.push(name);
        }
      }
      // Empate: NO eliminar a nadie, mostrar mensaje especial
      if (eliminados.length > 1) {
        io.in(room).emit("vote_tie", eliminados);
        sala.votes = {};
        // Nueva ronda de hablar con los mismos vivos
        const vivosPlayers = sala.players
          .map(p => p.name)
          .filter(name => !sala.eliminated.includes(name));
        let order = vivosPlayers.sort(() => Math.random() - 0.5);
        talkOrders[room] = order;
        talkIndexes[room] = 0;
        setTimeout(() => {
          io.in(room).emit("start_talk", { order });
        }, 2300);
        return;
      }

      // Eliminación normal
      const eliminado = eliminados[0];
      sala.eliminated.push(eliminado);

      io.in(room).emit("player_eliminated", eliminado);

      const impostoresVivos = sala.players
        .map(p => p.name)
        .filter(name => sala.roles[name] === 'impostor' && !sala.eliminated.includes(name)).length;
      const inocentesVivos = sala.players
        .map(p => p.name)
        .filter(name => sala.roles[name] === 'innocent' && !sala.eliminated.includes(name)).length;

      sala.votes = {};

      if (impostoresVivos === 0) {
        io.in(room).emit('show_results', {
          title: "¡Inocentes ganan!",
          info: `El impostor era ${eliminado}.`,
          image: "/img/victoria-inocentes.jpg"
        });
      } else if (inocentesVivos <= 1) {
        io.in(room).emit('show_results', {
          title: "¡Impostores ganan!",
          info: `Sobrevivieron los impostores.`,
          image: "/img/victoria-impostores.jpg"
        });
      } else {
        const vivosPlayers = sala.players
          .map(p => p.name)
          .filter(name => !sala.eliminated.includes(name));
        let order = vivosPlayers.sort(() => Math.random() - 0.5);
        talkOrders[room] = order;
        talkIndexes[room] = 0;
        io.in(room).emit("start_talk", { order });
      }
    }
  });

  socket.on('restart', ({ room }) => {
    if (!rooms[room]) return;
    rooms[room].suggestions = {};
    rooms[room].eliminated = [];
    rooms[room].votes = {};
    io.in(room).emit('restart');
    emitLobbyUpdate(room);
    talkOrders[room] = undefined;
    talkIndexes[room] = undefined;
  });

  socket.on('disconnect', () => {
    for (let room in rooms) {
      const idx = rooms[room].players.findIndex(p => p.socketId === socket.id);
      if (idx !== -1) {
        rooms[room].players.splice(idx, 1);
        if (rooms[room].hostSocketId === socket.id && rooms[room].players.length > 0) {
          rooms[room].hostSocketId = rooms[room].players[0].socketId;
          rooms[room].hostName = rooms[room].players[0].name;
        }
        if (rooms[room].players.length === 0) {
          delete rooms[room];
        } else {
          emitLobbyUpdate(room);
        }
        break;
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Servidor iniciado en http://localhost:${PORT}`);
});
