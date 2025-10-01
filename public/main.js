const socket = io();

// -- Pantalla inicial
const createRoomForm = document.getElementById("createRoomForm");
const joinRoomForm = document.getElementById("joinRoomForm");
const hostNameInput = document.getElementById("hostNameInput");
const roomInput = document.getElementById("roomInput");
const nameInput = document.getElementById("nameInput");

// -- Lobby
const lobbyScreen = document.getElementById("lobbyScreen");
const lobbyRoomCode = document.getElementById("lobbyRoomCode");
const lobbyPlayers = document.getElementById("lobbyPlayers");
const hostControls = document.getElementById("hostControls");
const impostorsSelect = document.getElementById("impostorsSelect");
const nameSuggestForm = document.getElementById("nameSuggestForm");
const suggestedNameInput = document.getElementById("suggestedNameInput");
const startGameBtn = document.getElementById("startGameBtn");
const addNameBtn = document.getElementById("addNameBtn");

// -- TURNO DE HABLAR
const talkScreen = document.getElementById("talkScreen");
const talkTitle = document.getElementById("talkTitle");
const talkInfo = document.getElementById("talkInfo");
const talkDoneBtn = document.getElementById("talkDoneBtn");

// NUEVO: rol y palabra secreta en hablar
let talkRole = document.getElementById("talkRole");
let talkSecret = document.getElementById("talkSecret");
if (!talkRole) {
  // Agregar los elementos si no existen
  const card = talkScreen.querySelector('.form-card');
  talkRole = document.createElement("div");
  talkRole.id = "talkRole";
  talkRole.style = "font-weight:bold; font-size:1.2em; margin-bottom:4px;";
  card.insertBefore(talkRole, card.firstChild);
  talkSecret = document.createElement("div");
  talkSecret.id = "talkSecret";
  talkSecret.style = "color:#10d084; font-size:1em; margin-bottom:12px;";
  card.insertBefore(talkSecret, talkRole.nextSibling);
}

let talkOrder = [];
let talkIndex = 0;

// -- Votación
const voteScreen = document.getElementById("voteScreen");
const playersToVote = document.getElementById("playersToVote");
const confirmVoteBtn = document.getElementById("confirmVoteBtn");
const yourRoleText = document.getElementById("yourRoleText");
const secretWordBox = document.getElementById("secretWordBox");

// -- Resultados
const resultScreen = document.getElementById("resultScreen");
const resultTitle = document.getElementById("resultTitle");
const resultInfo = document.getElementById("resultInfo");
const playAgainBtn = document.getElementById("playAgainBtn");

let isHost = false;
let myRoom = "";
let myName = "";
let nameSuggested = false;
let myRole = null;
let secretWord = null;
let playersVotingList = [];
let selectedVote = null;

function showOnly(id) {
  [
    createRoomForm, joinRoomForm, lobbyScreen, voteScreen, resultScreen, talkScreen
  ].forEach(el => el.style.display = "none");
  if (id) id.style.display = "flex";
}

// Crear sala
createRoomForm.addEventListener("submit", function(e){
  e.preventDefault();
  const nombre = hostNameInput.value.trim();
  if(nombre.length < 2) {
    alert("Poné un nombre válido");
    return;
  }
  const codigo = Math.random().toString(36).substring(2,7).toUpperCase();
  myRoom = codigo;
  myName = nombre;
  isHost = true;
  socket.emit("join_room", { name: nombre, room: codigo, impostors: 1 });
  showLobby(codigo, [nombre], true);
});

// Unirse a sala
joinRoomForm.addEventListener("submit", function(e){
  e.preventDefault();
  const codigo = roomInput.value.trim().toUpperCase();
  const nombre = nameInput.value.trim();
  if(codigo.length < 3 || nombre.length < 2) {
    alert("Completá todos los campos correctamente");
    return;
  }
  myRoom = codigo;
  myName = nombre;
  isHost = false;
  socket.emit("join_room", { name: nombre, room: codigo });
});

// Mostrar lobby
function showLobby(codigo, jugadores, host) {
  showOnly(lobbyScreen);
  lobbyRoomCode.textContent = codigo;
  lobbyPlayers.innerHTML = "";
  jugadores.forEach(j => {
    const li = document.createElement("li");
    li.textContent = j;
    lobbyPlayers.appendChild(li);
  });
  hostControls.style.display = host ? "" : "none";
  impostorsSelect.disabled = !host;
  nameSuggested = false;
  suggestedNameInput.value = "";
  suggestedNameInput.disabled = false;
  addNameBtn.disabled = false;
  // Solo el host ve el botón de iniciar partida
  startGameBtn.style.display = host ? "" : "none";
}
socket.on("lobby_update", ({ room, players, hostName, impostors }) => {
  showLobby(room, players, myName === hostName);
  isHost = (myName === hostName); // Actualiza si el host cambia
  impostorsSelect.value = impostors || 1;
});

// Cambiar número de impostores (solo host)
impostorsSelect.onchange = function() {
  socket.emit("set_impostors", { room: myRoom, impostors: parseInt(impostorsSelect.value) });
};

// Sugerir nombre secreto (solo uno por jugador)
nameSuggestForm.addEventListener("submit", function(e) {
  e.preventDefault();
  if (nameSuggested) {
    alert("Ya enviaste tu nombre sugerido.");
    return;
  }
  const nombre = suggestedNameInput.value.trim();
  if (nombre.length < 2) {
    alert("Ingresá un nombre válido.");
    return;
  }
  socket.emit("suggest_secret", { suggestion: nombre, room: myRoom });
  nameSuggested = true;
  suggestedNameInput.value = "";
  suggestedNameInput.disabled = true;
  addNameBtn.disabled = true;
  suggestedNameInput.placeholder = "¡Nombre enviado!";
});

// Iniciar partida (solo host)
startGameBtn.onclick = function() {
  if (!isHost) return;
  socket.emit("start_game", { room: myRoom });
};

// --- TURNO DE HABLAR ---
socket.on("start_talk", ({ order }) => {
  talkOrder = order;
  talkIndex = 0;
  advanceTalkTurn();
});

function advanceTalkTurn() {
  const currentSpeaker = talkOrder[talkIndex];
  showOnly(talkScreen);

  // Mostrar rol y secreto arriba del cartel
  if (myRole === "impostor") {
    talkRole.textContent = "IMPOSTOR";
    talkRole.style.color = "#e74c3c";
    talkSecret.textContent = "";
  } else if (myRole === "innocent") {
    talkRole.textContent = "INOCENTE";
    talkRole.style.color = "#10d084";
    talkSecret.textContent = secretWord ? `Palabra secreta: "${secretWord}"` : "";
  } else {
    talkRole.textContent = "";
    talkSecret.textContent = "";
  }

  if (myName === currentSpeaker) {
    talkTitle.textContent = "¡Ahora te toca hablar!";
    talkInfo.textContent = "Habla y, cuando termines, pulsa el botón.";
    talkDoneBtn.style.display = "";
    talkDoneBtn.disabled = false;
  } else {
    talkTitle.textContent = `Es el turno de ${currentSpeaker}`;
    talkInfo.textContent = "Esperá tu turno para hablar...";
    talkDoneBtn.style.display = "none";
  }
}

talkDoneBtn.onclick = function() {
  talkDoneBtn.disabled = true;
  socket.emit("done_talk", { room: myRoom });
};

socket.on("next_talk", ({ index }) => {
  talkIndex = index;
  if (talkIndex < talkOrder.length) {
    advanceTalkTurn();
  }
});

// --- Votación ---
socket.on("role_assigned", ({ role, secret }) => {
  myRole = role;
  secretWord = (typeof secret === "string") ? secret : "";
});

socket.on("to_vote", players => {
  showOnly(voteScreen);
  playersToVote.innerHTML = "";
  playersVotingList = players;
  selectedVote = null;
  players.forEach(name => {
    if (name === myName) return;
    const btn = document.createElement("button");
    btn.className = "player-vote-btn";
    btn.textContent = name;
    btn.onclick = function() {
      Array.from(playersToVote.children).forEach(b => b.classList.remove("selected"));
      btn.classList.add("selected");
      selectedVote = name;
    };
    playersToVote.appendChild(btn);
  });
  if (myRole === "impostor") {
    yourRoleText.textContent = "IMPOSTOR";
    yourRoleText.style.color = "#e74c3c";
    secretWordBox.textContent = "";
  } else {
    yourRoleText.textContent = "INOCENTE";
    yourRoleText.style.color = "#10d084";
    secretWordBox.textContent = secretWord ? `"${secretWord}"` : "";
  }
  confirmVoteBtn.disabled = false;
});

confirmVoteBtn.onclick = function() {
  if (!selectedVote) {
    alert("Selecciona a alguien para votar.");
    return;
  }
  Array.from(playersToVote.children).forEach(b => b.disabled = true);
  confirmVoteBtn.disabled = true;
  socket.emit("vote", { target: selectedVote, room: myRoom });
};

socket.on("show_results", ({ title, info }) => {
  showOnly(resultScreen);
  resultTitle.textContent = title;
  resultInfo.textContent = info;
});

playAgainBtn.onclick = () => {
  socket.emit("restart", { room: myRoom });
};

socket.on("restart", () => {
  // Vuelve al lobby y restaura el botón de iniciar para el host
  socket.emit("join_room", { name: myName, room: myRoom });
  nameSuggested = false;
  talkOrder = [];
  talkIndex = 0;
});
