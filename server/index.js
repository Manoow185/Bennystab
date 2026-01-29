import express from "express";
import http from "http";
import { Server } from "socket.io";

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*"
  }
});

const PORT = process.env.PORT || 3000;

app.use(express.static(new URL("../client", import.meta.url).pathname));

const GAME_CONFIG = {
  minPlayers: 4,
  maxPlayers: 8,
  chatRange: 220,
  killRange: 60,
  reportRange: 80,
  repairRange: 80,
  sabotageCooldownMs: 30000,
  killCooldownMs: 25000,
  investigateCooldownMs: 40000,
  comptableRevealCooldownMs: 9999999,
  depanneurImmunityMs: 60000,
  discussionMs: 45000,
  votingMs: 30000,
  sabotageDurationMs: 20000,
  requireReady: true,
  taskPauseMs: 5000,
  taskPontWindowMs: 2000,
  tickMs: 100,
  moveSpeed: 220,
  chatCooldownMs: 800,
  chatMaxLen: 160
};

const SKINS = [
  "orange",
  "blue",
  "green",
  "purple",
  "yellow",
  "pink",
  "teal",
  "brown"
];

const ROOM_STATES = {
  LOBBY: "LOBBY",
  RUNNING: "RUNNING",
  DISCUSSION: "DISCUSSION",
  VOTING: "VOTING",
  RESOLVE: "RESOLVE",
  END: "END"
};

const TEAMS = {
  GENTILS: "gentils",
  SABOTEURS: "saboteurs"
};

const ROLES = {
  CHEF: "chef",
  MECANO: "mecano",
  COMPTABLE: "comptable",
  DEPANNEUR: "depanneur",
  VANILLA: "vanilla",
  SABOTEUR: "saboteur"
};

const MAP_ZONES = {
  garage: {
    bureau: { x: 60, y: 60, w: 120, h: 80 },
    stock: { x: 460, y: 60, w: 140, h: 90 },
    comptoir: { x: 260, y: 60, w: 140, h: 80 },
    atelier: { x: 60, y: 200, w: 160, h: 120 },
    pont: { x: 260, y: 200, w: 140, h: 120 },
    parking: { x: 460, y: 200, w: 140, h: 120 },
    cafe: { x: 60, y: 360, w: 140, h: 80 },
    nettoyage: { x: 240, y: 360, w: 140, h: 80 },
    produit: { x: 420, y: 360, w: 180, h: 80 },
    inventaire1: { x: 520, y: 120, w: 90, h: 60 },
    inventaire2: { x: 520, y: 260, w: 90, h: 60 },
    inventaire3: { x: 520, y: 380, w: 90, h: 60 }
  }
};

const rooms = new Map();

function randomId() {
  return Math.random().toString(36).slice(2, 10);
}

function now() {
  return Date.now();
}

function distance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

function isInsideZone(position, zone) {
  return (
    position.x >= zone.x &&
    position.x <= zone.x + zone.w &&
    position.y >= zone.y &&
    position.y <= zone.y + zone.h
  );
}

function findZone(mapId, position) {
  const zones = MAP_ZONES[mapId];
  if (!zones) {
    return null;
  }
  return Object.entries(zones).find(([, zone]) => isInsideZone(position, zone))?.[0] ?? null;
}

function createRoom(roomId, hostId) {
  const room = {
    id: roomId,
    hostId,
    state: ROOM_STATES.LOBBY,
    players: new Map(),
    skinsTaken: new Set(),
    mapId: "garage",
    startedAt: null,
    tickInterval: null,
    discussionTimer: null,
    voteTimer: null,
    sabotageTimer: null,
    votes: new Map(),
    sabotage: null,
    bodies: [],
    journal: [],
    lastProximityLogAt: 0
  };
  rooms.set(roomId, room);
  return room;
}

function getRoom(roomId) {
  return rooms.get(roomId);
}

function broadcastRoomState(room) {
  const players = Array.from(room.players.values()).map((player) => ({
    id: player.id,
    name: player.name,
    skin: player.skin,
    ready: player.ready,
    alive: player.alive,
    mapId: player.mapId,
    role: room.state === ROOM_STATES.LOBBY ? null : undefined
  }));
  io.to(room.id).emit("room:state", {
    id: room.id,
    hostId: room.hostId,
    state: room.state,
    players,
    skinsTaken: Array.from(room.skinsTaken),
    started: room.state !== ROOM_STATES.LOBBY
  });
}

function assignTeamsAndRoles(room) {
  const players = Array.from(room.players.values());
  const count = players.length;
  const saboteurCount =
    count === 4 ? 1 : count === 5 ? 2 : count === 6 ? 2 : count === 7 ? 2 : 3;
  const shuffled = players.sort(() => Math.random() - 0.5);
  const saboteurs = new Set(shuffled.slice(0, saboteurCount).map((p) => p.id));

  const gentilRoles = [];
  if (count === 4) {
    gentilRoles.push(ROLES.CHEF, ROLES.MECANO, ROLES.DEPANNEUR);
  } else if (count === 5) {
    gentilRoles.push(ROLES.CHEF, ROLES.MECANO, ROLES.COMPTABLE, ROLES.VANILLA);
  } else if (count === 6) {
    gentilRoles.push(ROLES.CHEF, ROLES.MECANO, ROLES.MECANO, ROLES.COMPTABLE);
  } else if (count === 7) {
    gentilRoles.push(
      ROLES.CHEF,
      ROLES.MECANO,
      ROLES.MECANO,
      ROLES.COMPTABLE,
      ROLES.DEPANNEUR
    );
  } else if (count === 8) {
    gentilRoles.push(
      ROLES.CHEF,
      ROLES.MECANO,
      ROLES.MECANO,
      ROLES.COMPTABLE,
      ROLES.DEPANNEUR
    );
  }

  const gentilPool = shuffled.filter((player) => !saboteurs.has(player.id));
  const shuffledRoles = gentilRoles.sort(() => Math.random() - 0.5);

  gentilPool.forEach((player, index) => {
    player.team = TEAMS.GENTILS;
    player.role = shuffledRoles[index] || ROLES.VANILLA;
  });

  saboteurs.forEach((id) => {
    const player = room.players.get(id);
    player.team = TEAMS.SABOTEURS;
    player.role = ROLES.SABOTEUR;
  });
}

function createTasks() {
  const ids = ["bureau", "stock", "comptoir", "atelier", "pont", "parking"];
  const shuffled = ids.sort(() => Math.random() - 0.5);
  return [
    {
      id: `task-car-${randomId()}`,
      type: "voiture",
      title: "Voiture à problème",
      steps: shuffled.slice(0, 3),
      progress: 0,
      completed: false
    },
    {
      id: `task-order-${randomId()}`,
      type: "commande",
      title: "Commande suspecte",
      required: ["bureau", "stock", "comptoir"],
      visited: [],
      completed: false
    },
    {
      id: `task-pont-${randomId()}`,
      type: "pont",
      title: "Réglage de pont élévateur",
      zone: "pont",
      windowStart: now() + 1500,
      completed: false,
      failed: 0
    },
    {
      id: `task-oil-${randomId()}`,
      type: "huile",
      title: "Fuite d’huile",
      step: "produit",
      completed: false
    },
    {
      id: `task-ghost-${randomId()}`,
      type: "inventaire",
      title: "Inventaire fantôme",
      real: ["inventaire1", "inventaire2", "inventaire3"],
      fake: "parking",
      checked: [],
      completed: false
    },
    {
      id: `task-coffee-${randomId()}`,
      type: "cafe",
      title: "Pause café",
      zone: "cafe",
      completed: false
    }
  ];
}

function sendTasks(player) {
  if (!player?.tasks) {
    return;
  }
  io.to(player.socketId).emit("game:tasks", player.tasks);
}

function updateTask(player, task) {
  io.to(player.socketId).emit("game:taskUpdate", task);
}

function startGame(room) {
  room.state = ROOM_STATES.RUNNING;
  room.startedAt = now();
  room.bodies = [];
  room.votes = new Map();
  room.sabotage = null;
  room.sabotageTimer = null;
  room.journal = [];

  assignTeamsAndRoles(room);

  room.players.forEach((player) => {
    player.alive = true;
    player.mapId = "garage";
    player.position = { x: 120 + Math.random() * 260, y: 120 + Math.random() * 260 };
    player.lastMoveAt = now();
    player.lastPosition = { ...player.position };
    player.cooldowns = {
      kill: 0,
      sabotage: 0,
      investigate: 0,
      comptableReveal: 0,
      depanneurHint: 0,
      chat: 0
    };
    player.tasks = createTasks();
    io.to(player.socketId).emit("game:start", {
      role: player.role,
      team: player.team,
      mapId: player.mapId
    });
    sendTasks(player);
  });

  broadcastRoomState(room);

  room.tickInterval = setInterval(() => {
    if (room.state === ROOM_STATES.RUNNING) {
      sendPlayersUpdate(room);
      maybeLogProximity(room);
    }
  }, GAME_CONFIG.tickMs);
}

function endGame(room, winner) {
  room.state = ROOM_STATES.END;
  console.log(`[ROOM ${room.id}] Fin de partie - gagnant: ${winner}`);
  const reveal = Array.from(room.players.values()).map((player) => ({
    id: player.id,
    name: player.name,
    role: player.role,
    team: player.team,
    alive: player.alive
  }));
  io.to(room.id).emit("game:end", { winner, reveal });
  clearTimers(room);
}

function sendPlayersUpdate(room) {
  const players = Array.from(room.players.values()).map((player) => ({
    id: player.id,
    name: player.name,
    x: player.position?.x ?? 0,
    y: player.position?.y ?? 0,
    alive: player.alive,
    mapId: player.mapId,
    skin: player.skin
  }));
  io.to(room.id).emit("game:playersUpdate", players);
}

function maybeLogProximity(room) {
  const current = now();
  if (current - room.lastProximityLogAt < 2000) {
    return;
  }
  room.lastProximityLogAt = current;
  const players = Array.from(room.players.values()).filter((player) => player.alive);
  for (let i = 0; i < players.length; i += 1) {
    for (let j = i + 1; j < players.length; j += 1) {
      const a = players[i];
      const b = players[j];
      if (a.mapId !== b.mapId) {
        continue;
      }
      if (distance(a.position, b.position) < 120) {
        room.journal.push({
          ts: current,
          text: `${a.name} était proche de ${b.name}`
        });
      }
    }
  }
  room.journal = room.journal.slice(-50);
}

function checkWin(room) {
  const alive = Array.from(room.players.values()).filter((player) => player.alive);
  const saboteurs = alive.filter((player) => player.team === TEAMS.SABOTEURS).length;
  const gentils = alive.filter((player) => player.team === TEAMS.GENTILS).length;
  if (saboteurs === 0) {
    endGame(room, TEAMS.GENTILS);
  } else if (saboteurs >= gentils) {
    endGame(room, TEAMS.SABOTEURS);
  }
}

function startDiscussion(room, reason) {
  if (room.state !== ROOM_STATES.RUNNING) {
    return;
  }
  room.state = ROOM_STATES.DISCUSSION;
  io.to(room.id).emit("discussion:start", {
    reason,
    durationMs: GAME_CONFIG.discussionMs
  });
  room.discussionTimer = setTimeout(() => {
    startVoting(room);
  }, GAME_CONFIG.discussionMs);
}

function startVoting(room) {
  room.state = ROOM_STATES.VOTING;
  room.votes = new Map();
  io.to(room.id).emit("vote:start", {
    durationMs: GAME_CONFIG.votingMs
  });
  room.voteTimer = setTimeout(() => {
    resolveVotes(room);
  }, GAME_CONFIG.votingMs);
}

function clearTimers(room) {
  if (room.tickInterval) {
    clearInterval(room.tickInterval);
    room.tickInterval = null;
  }
  if (room.discussionTimer) {
    clearTimeout(room.discussionTimer);
    room.discussionTimer = null;
  }
  if (room.voteTimer) {
    clearTimeout(room.voteTimer);
    room.voteTimer = null;
  }
  if (room.sabotageTimer) {
    clearTimeout(room.sabotageTimer);
    room.sabotageTimer = null;
  }
}

function resetRoom(room) {
  clearTimers(room);
  room.state = ROOM_STATES.LOBBY;
  room.startedAt = null;
  room.bodies = [];
  room.votes = new Map();
  room.sabotage = null;
  room.journal = [];
  room.players.forEach((player) => {
    player.ready = false;
    player.alive = true;
    player.team = null;
    player.role = null;
    player.mapId = "garage";
    player.position = { x: 120, y: 120 };
    player.cooldowns = {};
    player.usedComptableReveal = false;
    player.usedDepanneurHint = false;
    player.tasks = [];
  });
  broadcastRoomState(room);
}

function resolveVotes(room) {
  room.state = ROOM_STATES.RESOLVE;
  const tally = new Map();
  const chefIds = Array.from(room.players.values())
    .filter((player) => player.role === ROLES.CHEF)
    .map((player) => player.id);

  room.votes.forEach((vote, voterId) => {
    if (!vote) {
      return;
    }
    const weight = chefIds.includes(voterId) ? 2 : 1;
    const prev = tally.get(vote) || 0;
    tally.set(vote, prev + weight);
  });

  let eliminatedId = null;
  let topScore = 0;
  let tie = false;
  tally.forEach((score, targetId) => {
    if (score > topScore) {
      topScore = score;
      eliminatedId = targetId;
      tie = false;
    } else if (score === topScore) {
      tie = true;
    }
  });

  if (tie) {
    eliminatedId = null;
  }

  let result = { eliminatedId, tie, skip: eliminatedId === "skip" };
  if (eliminatedId && eliminatedId !== "skip") {
    const target = room.players.get(eliminatedId);
    const immune =
      target.role === ROLES.DEPANNEUR && now() - room.startedAt < GAME_CONFIG.depanneurImmunityMs;
    if (immune) {
      result = { eliminatedId: null, tie: false, skip: false, immune: true };
    } else if (target) {
      target.alive = false;
    }
  }

  console.log(
    `[ROOM ${room.id}] Vote terminé - éliminé: ${result.eliminatedId || "personne"}, ` +
      `tie: ${Boolean(result.tie)}, skip: ${Boolean(result.skip)}`
  );
  io.to(room.id).emit("vote:result", result);
  checkWin(room);
  if (room.state !== ROOM_STATES.END) {
    room.state = ROOM_STATES.RUNNING;
  }
}

function validateSkin(room, skin) {
  return SKINS.includes(skin) && !room.skinsTaken.has(skin);
}

function sendFeedback(player, message) {
  if (!player?.socketId || !message) {
    return;
  }
  io.to(player.socketId).emit("game:feedback", { message });
}

function handleMove(room, player, payload) {
  if (room.state !== ROOM_STATES.RUNNING || !player.alive) {
    return;
  }
  const { x, y } = payload;
  if (typeof x !== "number" || typeof y !== "number") {
    return;
  }
  const next = { x: Math.max(0, Math.min(640, x)), y: Math.max(0, Math.min(480, y)) };
  if (!player.lastPosition || distance(next, player.lastPosition) > 2) {
    player.lastMoveAt = now();
    player.lastPosition = { ...next };
  }
  player.position = next;
}

function handleKill(room, killer, targetId) {
  if (room.state !== ROOM_STATES.RUNNING) {
    sendFeedback(killer, "Action impossible hors phase.");
    return;
  }
  if (killer.team !== TEAMS.SABOTEURS || !killer.alive) {
    sendFeedback(killer, "Vous ne pouvez pas tuer.");
    return;
  }
  const target = room.players.get(targetId);
  if (!target || !target.alive || target.team === TEAMS.SABOTEURS) {
    sendFeedback(killer, "Cible invalide.");
    return;
  }
  if (now() - killer.cooldowns.kill < GAME_CONFIG.killCooldownMs) {
    sendFeedback(killer, "Kill en cooldown.");
    return;
  }
  const d = distance(killer.position, target.position);
  if (d > GAME_CONFIG.killRange) {
    sendFeedback(killer, "Trop loin pour tuer.");
    return;
  }
  if (
    target.role === ROLES.DEPANNEUR &&
    now() - room.startedAt < GAME_CONFIG.depanneurImmunityMs
  ) {
    sendFeedback(killer, "Cible immunisée.");
    return;
  }
  killer.cooldowns.kill = now();
  target.alive = false;
  room.bodies.push({
    id: target.id,
    x: target.position.x,
    y: target.position.y,
    mapId: target.mapId,
    reported: false
  });
  room.journal.push({ ts: now(), text: `${killer.name} a interagi avec ${target.name}` });
  console.log(`[ROOM ${room.id}] Kill - ${killer.name} a éliminé ${target.name}`);
  io.to(room.id).emit("game:event", { type: "kill", targetId: target.id });
  checkWin(room);
}

function handleReport(room, reporter) {
  if (room.state !== ROOM_STATES.RUNNING || !reporter.alive) {
    sendFeedback(reporter, "Action impossible hors phase.");
    return;
  }
  const body = room.bodies.find(
    (entry) =>
      !entry.reported &&
      entry.mapId === reporter.mapId &&
      distance(reporter.position, entry) <= GAME_CONFIG.reportRange
  );
  if (!body) {
    sendFeedback(reporter, "Aucun corps à portée.");
    return;
  }
  body.reported = true;
  room.journal.push({ ts: now(), text: `${reporter.name} a signalé un corps` });
  startDiscussion(room, { type: "bodyFound", reporterId: reporter.id });
}

function handleSabotage(room, actor, sabotageType) {
  if (room.state !== ROOM_STATES.RUNNING || !actor.alive) {
    sendFeedback(actor, "Action impossible hors phase.");
    return;
  }
  if (actor.team !== TEAMS.SABOTEURS) {
    sendFeedback(actor, "Vous ne pouvez pas saboter.");
    return;
  }
  if (now() - actor.cooldowns.sabotage < GAME_CONFIG.sabotageCooldownMs) {
    sendFeedback(actor, "Sabotage en cooldown.");
    return;
  }
  if (room.sabotage) {
    sendFeedback(actor, "Un sabotage est déjà actif.");
    return;
  }
  actor.cooldowns.sabotage = now();
  room.sabotage = {
    type: sabotageType || "lights",
    startedAt: now(),
    active: true
  };
  room.journal.push({ ts: now(), text: `${actor.name} a interagi avec une zone` });
  room.sabotageTimer = setTimeout(() => {
    room.sabotage = null;
    room.sabotageTimer = null;
    io.to(room.id).emit("game:event", { type: "sabotageEnd", reason: "timeout" });
  }, GAME_CONFIG.sabotageDurationMs);
  io.to(room.id).emit("game:event", {
    type: "sabotageStart",
    sabotage: room.sabotage,
    durationMs: GAME_CONFIG.sabotageDurationMs
  });
}

function handleRepair(room, actor) {
  if (room.state !== ROOM_STATES.RUNNING || !actor.alive) {
    sendFeedback(actor, "Action impossible hors phase.");
    return;
  }
  if (actor.role !== ROLES.MECANO || !room.sabotage) {
    sendFeedback(actor, "Réparation indisponible.");
    return;
  }
  if (distance(actor.position, { x: 320, y: 240 }) > GAME_CONFIG.repairRange) {
    sendFeedback(actor, "Trop loin pour réparer.");
    return;
  }
  room.sabotage = null;
  if (room.sabotageTimer) {
    clearTimeout(room.sabotageTimer);
    room.sabotageTimer = null;
  }
  room.journal.push({ ts: now(), text: `${actor.name} a réparé un sabotage` });
  io.to(room.id).emit("game:event", { type: "sabotageEnd" });
}

function handleInvestigate(room, actor, targetId) {
  if (room.state !== ROOM_STATES.RUNNING || !actor.alive) {
    sendFeedback(actor, "Action impossible hors phase.");
    return;
  }
  if (actor.role !== ROLES.CHEF) {
    sendFeedback(actor, "Seul le Chef peut enquêter.");
    return;
  }
  if (now() - actor.cooldowns.investigate < GAME_CONFIG.investigateCooldownMs) {
    sendFeedback(actor, "Enquête en cooldown.");
    return;
  }
  const target = room.players.get(targetId);
  if (!target || !target.alive) {
    sendFeedback(actor, "Cible invalide.");
    return;
  }
  actor.cooldowns.investigate = now();
  const bias = Math.random();
  const isSaboteur = target.team === TEAMS.SABOTEURS;
  const hint = isSaboteur
    ? bias > 0.25
      ? "Ce joueur semble plutôt louche."
      : "Ce joueur semble plutôt propre."
    : bias > 0.25
      ? "Ce joueur semble plutôt propre."
      : "Ce joueur semble plutôt louche.";
  io.to(actor.socketId).emit("game:event", {
    type: "investigationResult",
    targetId,
    hint
  });
}

function handleTask(room, actor, taskId) {
  if (room.state !== ROOM_STATES.RUNNING || !actor.alive) {
    sendFeedback(actor, "Action impossible hors phase.");
    return;
  }
  const task = actor.tasks?.find((entry) => entry.id === taskId);
  if (!task) {
    sendFeedback(actor, "Tâche introuvable.");
    return;
  }
  if (task.completed) {
    sendFeedback(actor, "Tâche déjà terminée.");
    return;
  }
  const zone = findZone(actor.mapId, actor.position);
  if (task.type === "voiture") {
    const expected = task.steps[task.progress];
    if (zone !== expected) {
      sendFeedback(actor, "Mauvaise zone pour cette étape.");
      return;
    }
    task.progress += 1;
    if (task.progress >= task.steps.length) {
      task.completed = true;
    }
    updateTask(actor, task);
  } else if (task.type === "commande") {
    if (!task.required.includes(zone)) {
      sendFeedback(actor, "Zone incorrecte pour comparer.");
      return;
    }
    if (!task.visited.includes(zone)) {
      task.visited.push(zone);
    }
    if (task.visited.length >= task.required.length) {
      task.completed = true;
    }
    updateTask(actor, task);
  } else if (task.type === "pont") {
    if (zone !== task.zone) {
      sendFeedback(actor, "Approchez-vous du pont.");
      return;
    }
    const inWindow =
      now() >= task.windowStart && now() <= task.windowStart + GAME_CONFIG.taskPontWindowMs;
    if (!inWindow) {
      task.failed += 1;
      task.windowStart = now() + 1000;
      updateTask(actor, task);
      io.to(room.id).emit("game:event", {
        type: "taskNoise",
        message: `${actor.name} a fait du bruit au pont élévateur.`
      });
      sendFeedback(actor, "Mauvais timing, recommencez.");
      return;
    }
    task.completed = true;
    updateTask(actor, task);
  } else if (task.type === "huile") {
    if (task.step === "produit") {
      if (zone !== "produit") {
        sendFeedback(actor, "Allez chercher le produit.");
        return;
      }
      task.step = "nettoyage";
      updateTask(actor, task);
      return;
    }
    if (task.step === "nettoyage") {
      if (zone !== "nettoyage") {
        sendFeedback(actor, "Zone de nettoyage incorrecte.");
        return;
      }
      task.completed = true;
      updateTask(actor, task);
    }
  } else if (task.type === "inventaire") {
    const allowed = [...task.real, task.fake];
    if (!allowed.includes(zone)) {
      sendFeedback(actor, "Poste d'inventaire incorrect.");
      return;
    }
    if (!task.checked.includes(zone)) {
      task.checked.push(zone);
    }
    const realChecked = task.checked.filter((entry) => task.real.includes(entry));
    if (realChecked.length >= task.real.length) {
      task.completed = true;
    }
    updateTask(actor, task);
  } else if (task.type === "cafe") {
    if (zone !== task.zone) {
      sendFeedback(actor, "Installez-vous à la pause café.");
      return;
    }
    const idleMs = now() - (actor.lastMoveAt || now());
    if (idleMs < GAME_CONFIG.taskPauseMs) {
      sendFeedback(actor, "Restez immobile quelques secondes.");
      return;
    }
    task.completed = true;
    updateTask(actor, task);
  }
}

function handleComptableReveal(room, actor) {
  if (room.state !== ROOM_STATES.RUNNING || !actor.alive) {
    sendFeedback(actor, "Action impossible hors phase.");
    return;
  }
  if (actor.role !== ROLES.COMPTABLE) {
    sendFeedback(actor, "Seul le Comptable peut révéler.");
    return;
  }
  if (actor.usedComptableReveal) {
    sendFeedback(actor, "Révélation déjà utilisée.");
    return;
  }
  actor.usedComptableReveal = true;
  const entry = room.journal[room.journal.length - 1];
  const text = entry ? entry.text : "Aucune interaction notable enregistrée.";
  io.to(room.id).emit("game:event", { type: "comptableReveal", text });
}

function handleComptablePeek(room, actor) {
  if (actor.role !== ROLES.COMPTABLE) {
    sendFeedback(actor, "Seul le Comptable a accès au journal.");
    return;
  }
  const entries = room.journal.slice(-5).map((entry) => entry.text);
  io.to(actor.socketId).emit("game:event", { type: "comptableJournal", entries });
}

function handleDepanneurHint(room, actor) {
  if (room.state !== ROOM_STATES.RUNNING || !actor.alive) {
    sendFeedback(actor, "Action impossible hors phase.");
    return;
  }
  if (actor.role !== ROLES.DEPANNEUR) {
    sendFeedback(actor, "Seul le Dépanneur peut obtenir un indice.");
    return;
  }
  if (actor.usedDepanneurHint) {
    sendFeedback(actor, "Indice déjà utilisé.");
    return;
  }
  actor.usedDepanneurHint = true;
  const hints = [
    "Activité suspecte vers la zone Stock récemment.",
    "Des bruits étranges près des bureaux.",
    "Quelqu'un traîne souvent vers le parking."
  ];
  const hint = hints[Math.floor(Math.random() * hints.length)];
  io.to(actor.socketId).emit("game:event", { type: "depanneurHint", hint });
}

function handleChat(room, actor, text) {
  if (!actor.alive) {
    return;
  }
  if (typeof text !== "string") {
    return;
  }
  const trimmed = text.trim().slice(0, GAME_CONFIG.chatMaxLen);
  if (!trimmed) {
    return;
  }
  if (now() - actor.cooldowns.chat < GAME_CONFIG.chatCooldownMs) {
    return;
  }
  actor.cooldowns.chat = now();

  if (room.state === ROOM_STATES.RUNNING) {
    const recipients = Array.from(room.players.values()).filter((player) => {
      if (!player.alive) {
        return false;
      }
      if (player.mapId !== actor.mapId) {
        return false;
      }
      return distance(player.position, actor.position) <= GAME_CONFIG.chatRange;
    });
    recipients.forEach((player) => {
      io.to(player.socketId).emit("chat:recv", {
        fromId: actor.id,
        fromName: actor.name,
        text: trimmed,
        channel: "proximity",
        ts: now()
      });
    });
  } else if ([ROOM_STATES.DISCUSSION, ROOM_STATES.VOTING].includes(room.state)) {
    room.players.forEach((player) => {
      if (!player.alive) {
        return;
      }
      io.to(player.socketId).emit("chat:recv", {
        fromId: actor.id,
        fromName: actor.name,
        text: trimmed,
        channel: "global",
        ts: now()
      });
    });
  }
}

function handleVote(room, voter, targetId) {
  if (room.state !== ROOM_STATES.VOTING || !voter.alive) {
    return;
  }
  if (targetId !== "skip" && !room.players.has(targetId)) {
    return;
  }
  room.votes.set(voter.id, targetId);
}

io.on("connection", (socket) => {
  socket.on("room:create", ({ name }) => {
    const roomId = randomId();
    const room = createRoom(roomId, socket.id);
    const player = {
      id: socket.id,
      socketId: socket.id,
      name: name?.slice(0, 16) || "Joueur",
      skin: null,
      ready: false,
      alive: true,
      team: null,
      role: null,
      mapId: "garage",
      position: { x: 120, y: 120 },
      cooldowns: {},
      usedComptableReveal: false,
      usedDepanneurHint: false
    };
    room.players.set(socket.id, player);
    socket.join(room.id);
    socket.emit("room:state", {
      id: room.id,
      hostId: room.hostId,
      state: room.state,
      players: [player],
      skinsTaken: [],
      started: false
    });
  });

  socket.on("room:join", ({ roomId, name }) => {
    const room = getRoom(roomId);
    if (!room) {
      socket.emit("room:error", { message: "Room introuvable." });
      return;
    }
    if (room.players.size >= GAME_CONFIG.maxPlayers) {
      socket.emit("room:error", { message: "Room complète." });
      return;
    }
    const player = {
      id: socket.id,
      socketId: socket.id,
      name: name?.slice(0, 16) || "Joueur",
      skin: null,
      ready: false,
      alive: true,
      team: null,
      role: null,
      mapId: "garage",
      position: { x: 160, y: 160 },
      cooldowns: {},
      usedComptableReveal: false,
      usedDepanneurHint: false
    };
    room.players.set(socket.id, player);
    socket.join(room.id);
    broadcastRoomState(room);
  });

  socket.on("lobby:skinSelect", ({ roomId, skin }) => {
    const room = getRoom(roomId);
    if (!room || room.state !== ROOM_STATES.LOBBY) {
      return;
    }
    const player = room.players.get(socket.id);
    if (!player) {
      return;
    }
    if (player.skin) {
      room.skinsTaken.delete(player.skin);
    }
    if (!validateSkin(room, skin)) {
      player.skin = null;
    } else {
      player.skin = skin;
      room.skinsTaken.add(skin);
    }
    broadcastRoomState(room);
    io.to(room.id).emit("skins:update", Array.from(room.skinsTaken));
  });

  socket.on("lobby:ready", ({ roomId, ready }) => {
    const room = getRoom(roomId);
    if (!room || room.state !== ROOM_STATES.LOBBY) {
      return;
    }
    const player = room.players.get(socket.id);
    if (!player) {
      return;
    }
    player.ready = Boolean(ready);
    broadcastRoomState(room);
  });

  socket.on("lobby:start", ({ roomId }) => {
    const room = getRoom(roomId);
    if (!room || room.state !== ROOM_STATES.LOBBY) {
      return;
    }
    if (room.hostId !== socket.id) {
      return;
    }
    if (room.players.size < GAME_CONFIG.minPlayers) {
      sendFeedback(room.players.get(socket.id), "Minimum 4 joueurs requis.");
      return;
    }
    const players = Array.from(room.players.values());
    if (players.some((player) => !player.skin)) {
      sendFeedback(room.players.get(socket.id), "Tous les joueurs doivent choisir un skin.");
      return;
    }
    if (GAME_CONFIG.requireReady && players.some((player) => !player.ready)) {
      sendFeedback(room.players.get(socket.id), "Tous les joueurs doivent être ready.");
      return;
    }
    startGame(room);
  });

  socket.on("room:reset", ({ roomId }) => {
    const room = getRoom(roomId);
    if (!room) {
      return;
    }
    if (room.hostId !== socket.id) {
      return;
    }
    resetRoom(room);
  });

  socket.on("game:move", ({ roomId, x, y }) => {
    const room = getRoom(roomId);
    if (!room) {
      return;
    }
    const player = room.players.get(socket.id);
    if (!player) {
      return;
    }
    handleMove(room, player, { x, y });
  });

  socket.on("game:kill", ({ roomId, targetId }) => {
    const room = getRoom(roomId);
    if (!room) {
      return;
    }
    const player = room.players.get(socket.id);
    if (!player) {
      return;
    }
    handleKill(room, player, targetId);
  });

  socket.on("game:interact", ({ roomId, type, targetId }) => {
    const room = getRoom(roomId);
    if (!room) {
      return;
    }
    const player = room.players.get(socket.id);
    if (!player) {
      return;
    }
    if (type === "report") {
      handleReport(room, player);
    }
    if (type === "repair") {
      handleRepair(room, player);
    }
    if (type === "emergency") {
      startDiscussion(room, { type: "emergency", callerId: player.id });
    }
    if (type === "investigate") {
      handleInvestigate(room, player, targetId);
    }
    if (type === "journalPeek") {
      handleComptablePeek(room, player);
    }
    if (type === "comptableReveal") {
      handleComptableReveal(room, player);
    }
    if (type === "depanneurHint") {
      handleDepanneurHint(room, player);
    }
    if (type === "task") {
      handleTask(room, player, targetId);
    }
  });

  socket.on("game:sabotage", ({ roomId, type }) => {
    const room = getRoom(roomId);
    if (!room) {
      return;
    }
    const player = room.players.get(socket.id);
    if (!player) {
      return;
    }
    handleSabotage(room, player, type);
  });

  socket.on("vote:cast", ({ roomId, targetId }) => {
    const room = getRoom(roomId);
    if (!room) {
      return;
    }
    const player = room.players.get(socket.id);
    if (!player) {
      return;
    }
    handleVote(room, player, targetId);
  });

  socket.on("chat:send", ({ roomId, text }) => {
    const room = getRoom(roomId);
    if (!room) {
      return;
    }
    const player = room.players.get(socket.id);
    if (!player) {
      return;
    }
    handleChat(room, player, text);
  });

  socket.on("disconnect", () => {
    rooms.forEach((room) => {
      if (!room.players.has(socket.id)) {
        return;
      }
      const player = room.players.get(socket.id);
      if (player?.skin) {
        room.skinsTaken.delete(player.skin);
      }
      room.players.delete(socket.id);
      if (room.hostId === socket.id) {
        const nextHost = room.players.values().next().value;
        room.hostId = nextHost ? nextHost.id : null;
      }
      if (room.players.size === 0) {
        rooms.delete(room.id);
        return;
      }
      broadcastRoomState(room);
      if (
        [ROOM_STATES.RUNNING, ROOM_STATES.DISCUSSION, ROOM_STATES.VOTING, ROOM_STATES.RESOLVE].includes(
          room.state
        )
      ) {
        checkWin(room);
      }
    });
  });
});

server.listen(PORT, () => {
  console.log(`BennyStab server running on ${PORT}`);
});
