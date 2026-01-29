const socket = io();

const skinColors = [
  "orange",
  "blue",
  "green",
  "purple",
  "yellow",
  "pink",
  "teal",
  "brown"
];

const lobbySection = document.getElementById("lobby");
const gameSection = document.getElementById("game");
const createRoomBtn = document.getElementById("createRoom");
const joinRoomBtn = document.getElementById("joinRoom");
const playerNameInput = document.getElementById("playerName");
const roomIdInput = document.getElementById("roomId");
const currentRoomLabel = document.getElementById("currentRoom");
const hostLabel = document.getElementById("hostLabel");
const stateLabel = document.getElementById("stateLabel");
const skinsContainer = document.getElementById("skins");
const readyToggle = document.getElementById("readyToggle");
const startGameBtn = document.getElementById("startGame");
const playersList = document.getElementById("playersList");
const roleLabel = document.getElementById("roleLabel");
const teamLabel = document.getElementById("teamLabel");
const phaseLabel = document.getElementById("phaseLabel");
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
const reportBtn = document.getElementById("reportBtn");
const sabotageBtn = document.getElementById("sabotageBtn");
const killBtn = document.getElementById("killBtn");
const repairBtn = document.getElementById("repairBtn");
const investigateBtn = document.getElementById("investigateBtn");
const journalBtn = document.getElementById("journalBtn");
const comptableRevealBtn = document.getElementById("comptableRevealBtn");
const depanneurHintBtn = document.getElementById("depanneurHintBtn");
const emergencyBtn = document.getElementById("emergencyBtn");
const votePanel = document.getElementById("votePanel");
const voteOptions = document.getElementById("voteOptions");
const skipVoteBtn = document.getElementById("skipVote");
const chatMessages = document.getElementById("chatMessages");
const chatForm = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");
const chatChannel = document.getElementById("chatChannel");
const targetSelect = document.getElementById("targetSelect");
const resetRoomBtn = document.getElementById("resetRoom");
const endScreen = document.getElementById("endScreen");
const endWinner = document.getElementById("endWinner");
const endReveal = document.getElementById("endReveal");
const endClose = document.getElementById("endClose");
const taskSelect = document.getElementById("taskSelect");
const tasksList = document.getElementById("tasksList");
const taskInteractBtn = document.getElementById("taskInteract");

let roomId = null;
let playerId = null;
let players = [];
let me = null;
let phase = "";
let hostId = null;
let lightsOut = false;
let lightsOutTimer = null;
let tasks = [];
let inputState = {
  up: false,
  down: false,
  left: false,
  right: false
};

function renderSkins(selected) {
  skinsContainer.innerHTML = "";
  skinColors.forEach((skin) => {
    const div = document.createElement("div");
    div.className = "skin-item";
    if (selected === skin) {
      div.classList.add("selected");
    }
    div.dataset.skin = skin;
    div.innerHTML = `
      <div class="skin-swatch" style="background:${skin}"></div>
      <div class="skin-name">${skin}</div>
    `;
    skinsContainer.appendChild(div);
  });
}

function updateSkinLocks(locked) {
  skinsContainer.querySelectorAll(".skin-item").forEach((div) => {
    const skin = div.dataset.skin;
    if (locked.includes(skin)) {
      div.classList.add("taken");
    } else {
      div.classList.remove("taken");
    }
  });
}

function renderPlayersList(roomPlayers, hostId) {
  playersList.innerHTML = "";
  roomPlayers.forEach((player) => {
    const card = document.createElement("div");
    card.className = "player-card";
    const badge = player.skin ? `<div class="player-avatar" style="background:${player.skin}"></div>` : `<div class="player-avatar"></div>`;
    card.innerHTML = `
      ${badge}
      <div>
        <div><strong>${player.name}</strong> ${player.id === hostId ? "(Host)" : ""}</div>
        <div>Skin: ${player.skin || "-"}</div>
        <div>Ready: ${player.ready ? "✅" : "⏳"}</div>
      </div>
    `;
    playersList.appendChild(card);
  });
}

function setPhase(newPhase) {
  phase = newPhase;
  phaseLabel.textContent = newPhase;
  if (newPhase === "RUNNING") {
    chatChannel.textContent = "PROXIMITÉ";
  } else if (newPhase === "DISCUSSION" || newPhase === "VOTING") {
    chatChannel.textContent = "GLOBAL";
  }
}

function addChatMessage({ fromName, text, channel }) {
  const div = document.createElement("div");
  div.className = "chat-message";
  div.textContent = `[${channel}] ${fromName}: ${text}`;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function showFeedback(message) {
  if (!message) {
    return;
  }
  addChatMessage({ fromName: "Info", text: message, channel: "system" });
}

function formatTask(task) {
  if (task.type === "voiture") {
    return `${task.title} (${task.progress}/${task.steps.length})`;
  }
  if (task.type === "commande") {
    return `${task.title} (${task.visited.length}/${task.required.length})`;
  }
  if (task.type === "pont") {
    return `${task.title} (${task.failed} ratés)`;
  }
  if (task.type === "huile") {
    return `${task.title} (${task.step})`;
  }
  if (task.type === "inventaire") {
    return `${task.title} (${task.checked.length}/${task.real.length})`;
  }
  if (task.type === "cafe") {
    return `${task.title} (pause)`;
  }
  return task.title;
}

function renderTasks() {
  tasksList.innerHTML = "";
  taskSelect.innerHTML = "";
  tasks.forEach((task) => {
    const option = document.createElement("option");
    option.value = task.id;
    option.textContent = task.title;
    taskSelect.appendChild(option);

    const li = document.createElement("li");
    li.textContent = formatTask(task);
    if (task.completed) {
      li.classList.add("task-complete");
      li.textContent += " ✓";
    }
    tasksList.appendChild(li);
  });
}

function updateHostControls() {
  if (!roomId || !resetRoomBtn) {
    return;
  }
  const isHost = hostId === playerId;
  resetRoomBtn.disabled = !isHost;
  resetRoomBtn.textContent = isHost ? "Reset room" : "Reset room (host)";
}

function updateTargetSelect() {
  targetSelect.innerHTML = "";
  players
    .filter((player) => player.alive && player.id !== playerId)
    .forEach((player) => {
      const option = document.createElement("option");
      option.value = player.id;
      option.textContent = player.name;
      targetSelect.appendChild(option);
    });
}

createRoomBtn.addEventListener("click", () => {
  const name = playerNameInput.value.trim();
  socket.emit("room:create", { name });
});

joinRoomBtn.addEventListener("click", () => {
  const name = playerNameInput.value.trim();
  const code = roomIdInput.value.trim();
  socket.emit("room:join", { roomId: code, name });
});

skinsContainer.addEventListener("click", (event) => {
  const skin = event.target.dataset.skin;
  if (!skin || event.target.classList.contains("taken")) {
    return;
  }
  socket.emit("lobby:skinSelect", { roomId, skin });
});

readyToggle.addEventListener("change", () => {
  socket.emit("lobby:ready", { roomId, ready: readyToggle.checked });
});

startGameBtn.addEventListener("click", () => {
  socket.emit("lobby:start", { roomId });
});

reportBtn.addEventListener("click", () => {
  socket.emit("game:interact", { roomId, type: "report" });
});

sabotageBtn.addEventListener("click", () => {
  socket.emit("game:sabotage", { roomId, type: "lights" });
});

killBtn.addEventListener("click", () => {
  if (!targetSelect.value) {
    return;
  }
  socket.emit("game:kill", { roomId, targetId: targetSelect.value });
});

repairBtn.addEventListener("click", () => {
  socket.emit("game:interact", { roomId, type: "repair" });
});

investigateBtn.addEventListener("click", () => {
  if (!targetSelect.value) {
    return;
  }
  socket.emit("game:interact", { roomId, type: "investigate", targetId: targetSelect.value });
});

journalBtn.addEventListener("click", () => {
  socket.emit("game:interact", { roomId, type: "journalPeek" });
});

comptableRevealBtn.addEventListener("click", () => {
  socket.emit("game:interact", { roomId, type: "comptableReveal" });
});

depanneurHintBtn.addEventListener("click", () => {
  socket.emit("game:interact", { roomId, type: "depanneurHint" });
});

emergencyBtn.addEventListener("click", () => {
  socket.emit("game:interact", { roomId, type: "emergency" });
});

resetRoomBtn.addEventListener("click", () => {
  socket.emit("room:reset", { roomId });
});

taskInteractBtn.addEventListener("click", () => {
  if (!taskSelect.value) {
    return;
  }
  socket.emit("game:interact", { roomId, type: "task", targetId: taskSelect.value });
});

endClose.addEventListener("click", () => {
  endScreen.classList.add("hidden");
});

skipVoteBtn.addEventListener("click", () => {
  socket.emit("vote:cast", { roomId, targetId: "skip" });
});

chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = chatInput.value.trim();
  if (!text) {
    return;
  }
  socket.emit("chat:send", { roomId, text });
  chatInput.value = "";
});

window.addEventListener("keydown", (event) => {
  if (event.key === "ArrowUp" || event.key === "w") {
    inputState.up = true;
  }
  if (event.key === "ArrowDown" || event.key === "s") {
    inputState.down = true;
  }
  if (event.key === "ArrowLeft" || event.key === "a") {
    inputState.left = true;
  }
  if (event.key === "ArrowRight" || event.key === "d") {
    inputState.right = true;
  }
});

window.addEventListener("keyup", (event) => {
  if (event.key === "ArrowUp" || event.key === "w") {
    inputState.up = false;
  }
  if (event.key === "ArrowDown" || event.key === "s") {
    inputState.down = false;
  }
  if (event.key === "ArrowLeft" || event.key === "a") {
    inputState.left = false;
  }
  if (event.key === "ArrowRight" || event.key === "d") {
    inputState.right = false;
  }
});

function gameLoop() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#1f2937";
  ctx.fillRect(40, 40, 560, 400);

  players.forEach((player) => {
    ctx.beginPath();
    ctx.fillStyle = player.alive ? player.skin || "white" : "#4b5563";
    ctx.arc(player.x, player.y, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#f5f6f8";
    ctx.fillText(player.name, player.x - 12, player.y - 18);
  });

  if (lightsOut) {
    ctx.save();
    ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (me) {
      ctx.globalCompositeOperation = "destination-out";
      const radius = 90;
      const gradient = ctx.createRadialGradient(me.x, me.y, 10, me.x, me.y, radius);
      gradient.addColorStop(0, "rgba(0,0,0,1)");
      gradient.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(me.x, me.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  requestAnimationFrame(gameLoop);
}

function sendMove() {
  if (!me || phase !== "RUNNING") {
    return;
  }
  let x = me.x;
  let y = me.y;
  const speed = 3;
  if (inputState.up) y -= speed;
  if (inputState.down) y += speed;
  if (inputState.left) x -= speed;
  if (inputState.right) x += speed;
  if (x !== me.x || y !== me.y) {
    socket.emit("game:move", { roomId, x, y });
  }
}

setInterval(sendMove, 50);
requestAnimationFrame(gameLoop);

socket.on("room:state", (payload) => {
  roomId = payload.id;
  currentRoomLabel.textContent = payload.id;
  hostId = payload.hostId;
  hostLabel.textContent = payload.hostId === socket.id ? "Vous" : payload.hostId;
  stateLabel.textContent = payload.state;
  renderSkins(payload.players.find((p) => p.id === socket.id)?.skin || null);
  updateSkinLocks(payload.skinsTaken);
  renderPlayersList(payload.players, payload.hostId);
  playerId = socket.id;
  updateHostControls();
  if (payload.started) {
    lobbySection.classList.add("hidden");
    gameSection.classList.remove("hidden");
  } else {
    lobbySection.classList.remove("hidden");
    gameSection.classList.add("hidden");
    roleLabel.textContent = "-";
    teamLabel.textContent = "-";
    teamLabel.classList.remove("team-gentils", "team-saboteurs");
    setPhase("LOBBY");
    lightsOut = false;
    endScreen.classList.add("hidden");
    endReveal.innerHTML = "";
    tasks = [];
    renderTasks();
  }
});

socket.on("skins:update", (locked) => {
  updateSkinLocks(locked);
});

socket.on("game:start", ({ role, team }) => {
  roleLabel.textContent = role;
  teamLabel.textContent = team;
  teamLabel.classList.remove("team-gentils", "team-saboteurs");
  teamLabel.classList.add(team === "gentils" ? "team-gentils" : "team-saboteurs");
  setPhase("RUNNING");
});

socket.on("game:tasks", (payload) => {
  tasks = payload || [];
  renderTasks();
});

socket.on("game:playersUpdate", (payload) => {
  players = payload;
  me = players.find((player) => player.id === playerId) || me;
  updateTargetSelect();
});

socket.on("game:taskUpdate", (updated) => {
  tasks = tasks.map((task) => (task.id === updated.id ? updated : task));
  renderTasks();
});

socket.on("discussion:start", () => {
  setPhase("DISCUSSION");
});

socket.on("vote:start", () => {
  setPhase("VOTING");
  votePanel.classList.remove("hidden");
  voteOptions.innerHTML = "";
  players
    .filter((player) => player.alive)
    .forEach((player) => {
      const div = document.createElement("div");
      div.className = "vote-option";
      div.innerHTML = `<span>${player.name}</span><button data-id="${player.id}">Vote</button>`;
      voteOptions.appendChild(div);
    });
});

voteOptions.addEventListener("click", (event) => {
  const targetId = event.target.dataset.id;
  if (!targetId) {
    return;
  }
  socket.emit("vote:cast", { roomId, targetId });
});

socket.on("vote:result", (result) => {
  votePanel.classList.add("hidden");
  setPhase("RUNNING");
  if (result.eliminatedId) {
    addChatMessage({ fromName: "Système", text: "Un joueur a été éliminé.", channel: "system" });
  } else if (result.immune) {
    addChatMessage({ fromName: "Système", text: "Le dépanneur était immunisé.", channel: "system" });
  } else {
    addChatMessage({ fromName: "Système", text: "Aucun joueur éliminé.", channel: "system" });
  }
});

socket.on("game:event", (payload) => {
  if (payload.type === "investigationResult") {
    addChatMessage({ fromName: "Enquête", text: payload.hint, channel: "system" });
  }
  if (payload.type === "comptableJournal") {
    payload.entries.forEach((entry) => {
      addChatMessage({ fromName: "Journal", text: entry, channel: "system" });
    });
  }
  if (payload.type === "comptableReveal") {
    addChatMessage({ fromName: "Comptable", text: payload.text, channel: "system" });
  }
  if (payload.type === "depanneurHint") {
    addChatMessage({ fromName: "Dépanneur", text: payload.hint, channel: "system" });
  }
  if (payload.type === "sabotageStart") {
    if (payload.sabotage?.type === "lights") {
      lightsOut = true;
      if (lightsOutTimer) {
        clearTimeout(lightsOutTimer);
      }
      lightsOutTimer = setTimeout(() => {
        lightsOut = false;
        lightsOutTimer = null;
      }, payload.durationMs || 20000);
    }
    addChatMessage({ fromName: "Système", text: "Sabotage en cours!", channel: "system" });
  }
  if (payload.type === "sabotageEnd") {
    lightsOut = false;
    if (lightsOutTimer) {
      clearTimeout(lightsOutTimer);
      lightsOutTimer = null;
    }
    addChatMessage({ fromName: "Système", text: "Sabotage réparé.", channel: "system" });
  }
  if (payload.type === "taskNoise") {
    addChatMessage({ fromName: "Système", text: payload.message, channel: "system" });
  }
});

socket.on("chat:recv", (payload) => {
  addChatMessage(payload);
});

socket.on("game:end", ({ winner, reveal }) => {
  addChatMessage({ fromName: "Système", text: `Victoire: ${winner}`, channel: "system" });
  endWinner.textContent = `Victoire: ${winner}`;
  endReveal.innerHTML = "";
  if (Array.isArray(reveal)) {
    reveal.forEach((entry) => {
      const item = document.createElement("li");
      item.textContent = `${entry.name} — ${entry.role} (${entry.team})`;
      endReveal.appendChild(item);
    });
  }
  endScreen.classList.remove("hidden");
  setPhase("END");
});

socket.on("room:error", ({ message }) => {
  alert(message);
});

socket.on("game:feedback", ({ message }) => {
  showFeedback(message);
});
