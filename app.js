"use strict";

const STAGES = ["suggestions", "practice", "ready"];
const DEMO_KEY = "empty-threats-demo-songs-v1";
const DEMO_LIKES_KEY = "empty-threats-demo-likes-v1";
const DEMO_PICKS_KEY = "empty-threats-demo-challenge-picks-v1";
const DEMO_RATINGS_KEY = "empty-threats-demo-challenge-ratings-v1";
const GIGS_URL = "https://www.livebandphotos.co.uk/band?Empty+Threats#main";
const LINK_LABEL = "Song link: ";
const state = { client: null, session: null, demo: false, memberName: "", songs: [], likes: [], likesReady: true, suggestionOrder: "added", activeStage: "suggestions", search: "", editingId: null, channel: null, challengeChannel: null, challengePicks: [], challengeRatings: [], challengeReady: true, sessionVersion: 0 };
const $ = (selector) => document.querySelector(selector);

const sampleSongs = [
  { id: "demo-1", title: "Everlong", artist: "Foo Fighters", suggested_by: "Jamie", notes: "Could work as the set closer.", stage: "suggestions" },
  { id: "demo-2", title: "Dreams", artist: "Fleetwood Mac", suggested_by: "Alex", notes: "Try a heavier arrangement.", stage: "suggestions" },
  { id: "demo-3", title: "Reptilia", artist: "The Strokes", suggested_by: "Morgan", notes: "Work on the guitar interplay.", stage: "practice" },
  { id: "demo-4", title: "Mr. Brightside", artist: "The Killers", suggested_by: "Sam", notes: "Crowd favourite. Keep the intro tight.", stage: "ready" }
].map((song, index) => ({ ...song, created_at: new Date(Date.now() - (index + 1) * 86400000).toISOString(), updated_at: new Date(Date.now() - (index + 1) * 86400000).toISOString() }));

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(date);
}

function songLinkService(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    const host = url.hostname.toLowerCase();
    if (host === "youtu.be" || host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtube-nocookie.com" || host.endsWith(".youtube-nocookie.com")) return "YouTube";
    if (host === "spotify.com" || host.endsWith(".spotify.com") || host === "spotify.link") return "Spotify";
  } catch { /* Invalid URL. */ }
  return null;
}

function unpackSongNotes(value) {
  const notes = String(value || "");
  const marker = notes.lastIndexOf(`\n\n${LINK_LABEL}`);
  const start = marker >= 0 ? marker + 2 : notes.startsWith(LINK_LABEL) ? 0 : -1;
  if (start < 0) return { text: notes, link: "" };
  const link = notes.slice(start + LINK_LABEL.length).trim();
  return songLinkService(link) ? { text: notes.slice(0, marker >= 0 ? marker : 0), link } : { text: notes, link: "" };
}

function packSongNotes(text, link) {
  return [text, link ? `${LINK_LABEL}${link}` : ""].filter(Boolean).join("\n\n") || null;
}

function showView(view) {
  $("#auth-view").hidden = view !== "auth";
  $("#board-view").hidden = view !== "board";
  $("#challenge-view").hidden = view !== "challenge";
  $("#gigs-view").hidden = view !== "gigs";
  $("#app-nav").hidden = view === "auth";
  document.querySelectorAll(".app-nav-button").forEach((button) => {
    const active = button.dataset.view === view;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
}

function boardMessage(message = "") { $("#board-message").textContent = message; }
function memberId() { return state.demo ? "demo-member" : state.session?.user?.id; }
function likeCount(songId) { return state.likes.filter((like) => like.song_id === songId).length; }
function hasLiked(songId) { return state.likes.some((like) => like.song_id === songId && like.user_id === memberId()); }
function authMessage(message = "", kind = "") {
  const element = $("#auth-message");
  element.textContent = message;
  element.className = `form-message ${kind}`;
}

function cardHtml(song, rank = null) {
  const index = STAGES.indexOf(song.stage);
  const { text: notes, link } = unpackSongNotes(song.notes);
  const service = link ? songLinkService(link) : null;
  const liked = index === 0 && state.likesReady && hasLiked(song.id);
  const count = rank === null ? 0 : likeCount(song.id);
  const votes = index !== 0 || !state.likesReady ? "" : `<div class="song-votes">${rank === null ? "" : `<span class="song-rank">#${rank}</span>`}<button class="like-button${liked ? " liked" : ""}" type="button" data-action="like" aria-pressed="${liked}" aria-label="${liked ? "Unlike" : "Like"} ${escapeHtml(song.title)}${rank === null ? "" : `; ${count} ${count === 1 ? "like" : "likes"}`}"><span aria-hidden="true">♥</span> ${liked ? "Liked" : "Like"}${rank === null ? "" : ` <strong>${count}</strong>`}</button></div>`;
  const back = index > 0 ? `<button class="move-button back" type="button" data-action="move" data-to="${STAGES[index - 1]}" aria-label="Move ${escapeHtml(song.title)} back to ${index === 1 ? "Suggestions" : "To Be Practiced"}">← ${index === 1 ? "Suggestions" : "Practice"}</button>` : "";
  const forward = index < 2 ? `<button class="move-button forward" type="button" data-action="move" data-to="${STAGES[index + 1]}" aria-label="Move ${escapeHtml(song.title)} to ${index === 0 ? "To Be Practiced" : "Gig Ready"}">${index === 0 ? "To be practiced" : "Gig ready"} →</button>` : "";
  return `<article class="song-card" data-id="${escapeHtml(song.id)}">
    <div class="card-top"><div><h3>${escapeHtml(song.title)}</h3><p class="artist">${escapeHtml(song.artist)}</p></div>
      <div class="card-tools"><button class="card-tool" type="button" data-action="edit" title="Edit song" aria-label="Edit ${escapeHtml(song.title)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4L16.5 3.5Z"></path></svg></button><button class="card-tool delete" type="button" data-action="delete" title="Delete song" aria-label="Delete ${escapeHtml(song.title)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 3h4M6 7l1 14h10l1-14M10 11v6M14 11v6"></path></svg></button></div></div>
    ${notes ? `<p class="song-notes">${escapeHtml(notes)}</p>` : ""}
    ${service ? `<a class="song-link" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer" aria-label="${service === "YouTube" ? "Watch" : "Listen to"} ${escapeHtml(song.title)} on ${service} (opens in a new tab)">${service === "YouTube" ? "Watch on YouTube" : "Listen on Spotify"} <span aria-hidden="true">↗</span></a>` : ""}
    ${votes}
    <div class="song-meta"><span class="suggested-by">Suggested by <strong>${escapeHtml(song.suggested_by)}</strong></span><span class="song-date">${escapeHtml(formatDate(song.created_at))}</span></div>
    <div class="card-actions">${back}${forward}</div>
  </article>`;
}

function renderBoard() {
  const term = state.search.trim().toLocaleLowerCase();
  $("#total-count").textContent = state.songs.length;
  document.querySelectorAll(".suggestion-order").forEach((button) => {
    const active = button.dataset.order === state.suggestionOrder;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
    button.disabled = button.dataset.order === "votes" && !state.likesReady;
  });
  for (const stage of STAGES) {
    const all = state.songs.filter((song) => song.stage === stage);
    if (stage === "suggestions") {
      all.sort((a, b) => (state.suggestionOrder === "votes" && state.likesReady ? likeCount(b.id) - likeCount(a.id) : 0)
        || new Date(a.created_at) - new Date(b.created_at) || a.title.localeCompare(b.title));
    }
    const ranks = new Map(all.map((song, index) => [song.id, index + 1]));
    const visible = term ? all.filter((song) => [song.title, song.artist, song.suggested_by, song.notes].some((value) => String(value || "").toLocaleLowerCase().includes(term))) : all;
    document.querySelectorAll(`[data-count="${stage}"]`).forEach((element) => { element.textContent = all.length; });
    $(`[data-list="${stage}"]`).innerHTML = visible.length
      ? visible.map((song) => cardHtml(song, stage === "suggestions" && state.likesReady && state.suggestionOrder === "votes" ? ranks.get(song.id) : null)).join("")
      : `<div class="empty-state"><span aria-hidden="true">✳</span><strong>${term ? "No matching songs" : stage === "suggestions" ? "Start with a suggestion" : stage === "practice" ? "Nothing to practice yet" : "Nothing gig ready yet"}</strong><small>${term ? "Try another search." : stage === "suggestions" ? "Add a song to get the ideas flowing." : "Move a song here when it’s time."}</small></div>`;
  }
  document.querySelectorAll(".mobile-tab, .lane").forEach((element) => {
    const active = element.dataset.stage === state.activeStage;
    element.classList.toggle("active", active);
    if (element.classList.contains("mobile-tab")) {
      element.setAttribute("aria-selected", String(active));
      element.tabIndex = active ? 0 : -1;
    }
  });
}

function saveDemo() { localStorage.setItem(DEMO_KEY, JSON.stringify(state.songs)); }
function saveDemoLikes() { localStorage.setItem(DEMO_LIKES_KEY, JSON.stringify(state.likes)); }

async function loadSongs() {
  if (state.demo) { renderBoard(); return; }
  const [songsResult, likesResult] = await Promise.all([
    state.client.from("songs").select("id,title,artist,suggested_by,notes,stage,created_at,updated_at").order("updated_at", { ascending: false }),
    state.client.from("song_likes").select("song_id,user_id")
  ]);
  if (songsResult.error) { boardMessage(`Couldn’t load songs: ${songsResult.error.message}`); return; }
  state.songs = songsResult.data || [];
  state.likesReady = !likesResult.error;
  state.likes = likesResult.data || [];
  if (!state.likesReady) state.suggestionOrder = "added";
  $("#likes-setup-message").hidden = state.likesReady;
  boardMessage();
  renderBoard();
}

function removeChannel() {
  if (state.channel) { state.client.removeChannel(state.channel); state.channel = null; }
  if (state.challengeChannel) { state.client.removeChannel(state.challengeChannel); state.challengeChannel = null; }
}

function subscribeToSongs() {
  removeChannel();
  const channel = state.client.channel("empty-threats-songs").on("postgres_changes", { event: "*", schema: "public", table: "songs" }, () => { void loadSongs(); });
  if (state.likesReady) channel.on("postgres_changes", { event: "*", schema: "public", table: "song_likes" }, () => { void loadSongs(); });
  state.channel = channel.subscribe();
}

async function handleSession(session) {
  const version = ++state.sessionVersion;
  const wasChallenge = !$("#challenge-view").hidden;
  const wasGigs = !$("#gigs-view").hidden;
  state.session = session;
  removeChannel();
  if (!session) { state.memberName = ""; showView("auth"); authMessage(); return; }
  const { data, error } = await state.client.from("band_members").select("user_id,display_name").eq("user_id", session.user.id).maybeSingle();
  if (version !== state.sessionVersion) return;
  if (error || !data) {
    showView("auth");
    authMessage(error ? `Couldn’t check band access: ${error.message}` : "");
    return;
  }
  if (data.display_name) localStorage.setItem("empty-threats-name", data.display_name);
  state.memberName = data.display_name;
  authMessage();
  showView("board");
  await loadSongs();
  if (version === state.sessionVersion) {
    subscribeToSongs();
    if (wasChallenge) await openChallenge();
    if (wasGigs) showView("gigs");
  }
}

async function ensureAnonymousSession() {
  const current = await state.client.auth.getSession();
  if (current.error) throw new Error(`Couldn’t check this browser’s session: ${current.error.message}`);
  if (current.data.session?.access_token) {
    state.session = current.data.session;
    return current.data.session;
  }
  const anonymous = await state.client.auth.signInAnonymously();
  if (anonymous.error || !anonymous.data.session?.access_token) {
    throw new Error(`Couldn’t start anonymous access: ${anonymous.error?.message || "No session was returned"}. Check that Anonymous Sign-Ins are enabled in Supabase.`);
  }
  state.session = anonymous.data.session;
  return anonymous.data.session;
}

function openSongDialog(song = null) {
  state.editingId = song?.id ?? null;
  $("#song-form").reset();
  $("#form-error").textContent = "";
  $("#dialog-title").textContent = song ? "Edit song" : "Add a song";
  $("#save-song").innerHTML = song ? `Save changes <span aria-hidden="true">↗</span>` : `Add to suggestions <span aria-hidden="true">↗</span>`;
  if (song) {
    $("#song-title").value = song.title;
    $("#song-artist").value = song.artist;
    $("#song-suggested-by").value = song.suggested_by;
    const { text, link } = unpackSongNotes(song.notes);
    $("#song-notes").value = text;
    $("#song-link").value = link;
  } else {
    $("#song-suggested-by").value = localStorage.getItem("empty-threats-name") || "";
  }
  $("#song-dialog").showModal();
  $("#song-title").focus();
}

async function saveSong(event) {
  event.preventDefault();
  const form = $("#song-form");
  if (!form.reportValidity()) return;
  const link = $("#song-link").value.trim();
  if (link && !songLinkService(link)) { $("#form-error").textContent = "Please use a full HTTPS YouTube or Spotify link."; return; }
  const notes = packSongNotes($("#song-notes").value.trim(), link);
  if (notes && notes.length > 1000) { $("#form-error").textContent = "Notes and link together must be under 1,000 characters. Shorten the notes or link."; return; }
  const payload = {
    title: $("#song-title").value.trim(),
    artist: $("#song-artist").value.trim(),
    suggested_by: $("#song-suggested-by").value.trim(),
    notes
  };
  if (!payload.title || !payload.artist || !payload.suggested_by) { $("#form-error").textContent = "Please fill in Song, Artist, and Suggested by."; return; }
  const button = $("#save-song");
  button.disabled = true;
  try {
    if (state.demo) {
      if (state.editingId) state.songs = state.songs.map((song) => song.id === state.editingId ? { ...song, ...payload, updated_at: new Date().toISOString() } : song);
      else state.songs.unshift({ ...payload, id: `demo-${Date.now()}-${Math.random().toString(36).slice(2)}`, stage: "suggestions", created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
      saveDemo();
    } else {
      const result = state.editingId
        ? await state.client.from("songs").update(payload).eq("id", state.editingId)
        : await state.client.from("songs").insert({ ...payload, stage: "suggestions" });
      if (result.error) throw result.error;
    }
    localStorage.setItem("empty-threats-name", payload.suggested_by);
    $("#song-dialog").close();
    await loadSongs();
  } catch (error) { $("#form-error").textContent = error.message || "Couldn’t save the song."; }
  finally { button.disabled = false; }
}

async function moveSong(song, target, button) {
  if (!STAGES.includes(target)) return;
  button.disabled = true;
  try {
    if (state.demo) {
      song.stage = target;
      song.updated_at = new Date().toISOString();
      saveDemo();
    } else {
      const { error } = await state.client.from("songs").update({ stage: target }).eq("id", song.id);
      if (error) throw error;
    }
    await loadSongs();
  } catch (error) { boardMessage(`Couldn’t move song: ${error.message}`); button.disabled = false; }
}

async function toggleLike(song, button) {
  const userId = memberId();
  if (!state.likesReady || !userId || song.stage !== "suggestions") return;
  const liked = hasLiked(song.id);
  button.disabled = true;
  try {
    if (state.demo) {
      state.likes = liked
        ? state.likes.filter((like) => like.song_id !== song.id || like.user_id !== userId)
        : [...state.likes, { song_id: song.id, user_id: userId }];
      saveDemoLikes();
    } else {
      const { error } = liked
        ? await state.client.from("song_likes").delete().eq("song_id", song.id).eq("user_id", userId)
        : await state.client.from("song_likes").insert({ song_id: song.id, user_id: userId });
      if (error) throw error;
    }
    await loadSongs();
  } catch (error) { boardMessage(`Couldn’t update like: ${error.message}`); button.disabled = false; }
}

async function deleteSong(song, button) {
  if (!window.confirm(`Delete “${song.title}” by ${song.artist}? This can’t be undone.`)) return;
  button.disabled = true;
  try {
    if (state.demo) { state.songs = state.songs.filter((item) => item.id !== song.id); state.likes = state.likes.filter((like) => like.song_id !== song.id); saveDemo(); saveDemoLikes(); }
    else {
      const { error } = await state.client.from("songs").delete().eq("id", song.id);
      if (error) throw error;
    }
    await loadSongs();
  } catch (error) { boardMessage(`Couldn’t delete song: ${error.message}`); button.disabled = false; }
}

function challengeMessage(message = "") { $("#challenge-message").textContent = message; }
function saveDemoChallenge() {
  localStorage.setItem(DEMO_PICKS_KEY, JSON.stringify(state.challengePicks));
  localStorage.setItem(DEMO_RATINGS_KEY, JSON.stringify(state.challengeRatings));
}

function challengeScore(pick) {
  const ratings = state.challengeRatings.filter((rating) => rating.pick_id === pick.id);
  return { total: 5 + ratings.reduce((sum, rating) => sum + rating.score, 0),
    fives: 1 + ratings.filter((rating) => rating.score === 5).length,
    threes: ratings.filter((rating) => rating.score === 3).length,
    ones: ratings.filter((rating) => rating.score === 1).length };
}

function challengeCardHtml(pick, rank) {
  const score = challengeScore(pick);
  const mine = pick.owner_user_id === memberId();
  const myRating = state.challengeRatings.find((rating) => rating.pick_id === pick.id && rating.voter_user_id === memberId())?.score;
  const service = pick.link_url ? songLinkService(pick.link_url) : null;
  const buttons = mine
    ? `<div class="challenge-own"><span>Your pick · automatic 5</span><button class="challenge-remove" type="button" data-action="remove-pick" aria-label="Remove ${escapeHtml(pick.title)} from your picks">Remove pick</button></div>`
    : `<div class="challenge-rate"><span>Your rating</span><div class="rating-buttons" role="group" aria-label="Rate ${escapeHtml(pick.title)}">${[[5, "Love it"], [3, "It’s OK"], [1, "Hate it"]].map(([value, label]) => `<button type="button" data-action="rate" data-score="${value}" class="rating-button${myRating === value ? " selected" : ""}" aria-pressed="${myRating === value}" aria-label="${value} points: ${label} for ${escapeHtml(pick.title)}">${value} <small>${label}</small></button>`).join("")}</div></div>`;
  return `<article class="challenge-card${score.ones ? " has-one" : ""}" data-id="${escapeHtml(pick.id)}">
    <div class="challenge-card-top"><span class="challenge-rank">#${rank}</span><div class="challenge-song"><h3>${escapeHtml(pick.title)}</h3><p>${escapeHtml(pick.artist)} · Picked by ${escapeHtml(pick.picked_by)}</p></div><div class="challenge-points"><strong>${score.total}</strong><span>points</span></div></div>
    ${score.ones ? `<p class="challenge-warning">⚠ Received ${score.ones} ${score.ones === 1 ? "rating" : "ratings"} of 1 — discuss before learning</p>` : ""}
    <div class="challenge-breakdown"><span>♥ ${score.fives} love</span><span>● ${score.threes} OK</span><span>▼ ${score.ones} hate</span></div>
    ${service ? `<a class="song-link" href="${escapeHtml(pick.link_url)}" target="_blank" rel="noopener noreferrer">${service === "YouTube" ? "Watch on YouTube" : "Listen on Spotify"} ↗</a>` : ""}
    ${buttons}
  </article>`;
}

function renderChallenge() {
  const myCount = state.challengePicks.filter((pick) => pick.owner_user_id === memberId()).length;
  $("#my-pick-count").textContent = `${myCount} of 4`;
  $("#add-pick").disabled = !state.challengeReady || myCount >= 4;
  $("#add-pick").title = myCount >= 4 ? "Remove one of your picks to add another" : "";
  $("#challenge-setup-message").hidden = state.challengeReady;
  const ranked = [...state.challengePicks].sort((a, b) => challengeScore(b).total - challengeScore(a).total
    || new Date(a.created_at) - new Date(b.created_at) || a.id.localeCompare(b.id));
  $("#challenge-list").innerHTML = ranked.length ? ranked.map((pick, index) => challengeCardHtml(pick, index + 1)).join("")
    : `<div class="empty-state"><span aria-hidden="true">✳</span><strong>No picks yet</strong><small>Add your first song to start the challenge.</small></div>`;
}

async function loadChallenge() {
  if (state.demo) { renderChallenge(); return; }
  const [picksResult, ratingsResult] = await Promise.all([
    state.client.from("challenge_picks").select("id,owner_user_id,picked_by,title,artist,link_url,created_at"),
    state.client.from("challenge_ratings").select("pick_id,voter_user_id,score")
  ]);
  state.challengeReady = !picksResult.error && !ratingsResult.error;
  if (!state.challengeReady) {
    state.challengePicks = [];
    state.challengeRatings = [];
    challengeMessage("The challenge could not load. Ask the band admin to finish the Supabase setup, then refresh.");
  } else {
    state.challengePicks = picksResult.data || [];
    state.challengeRatings = ratingsResult.data || [];
    challengeMessage();
  }
  renderChallenge();
}

function subscribeToChallenge() {
  if (state.demo || !state.challengeReady || state.challengeChannel) return;
  state.challengeChannel = state.client.channel("empty-threats-challenge")
    .on("postgres_changes", { event: "*", schema: "public", table: "challenge_picks" }, () => { void loadChallenge(); })
    .on("postgres_changes", { event: "*", schema: "public", table: "challenge_ratings" }, () => { void loadChallenge(); })
    .subscribe();
}

async function openChallenge() {
  showView("challenge");
  await loadChallenge();
  subscribeToChallenge();
}

function openGigs() {
  $("#gigs-frame").src = GIGS_URL;
  showView("gigs");
}

async function savePick(event) {
  event.preventDefault();
  const form = $("#pick-form");
  if (!form.reportValidity()) return;
  const link = $("#pick-link").value.trim();
  if (link && !songLinkService(link)) { $("#pick-form-error").textContent = "Please use a full HTTPS YouTube or Spotify link."; return; }
  const payload = { owner_user_id: memberId(), picked_by: state.memberName, title: $("#pick-title").value.trim(), artist: $("#pick-artist").value.trim(), link_url: link || null };
  if (!payload.title || !payload.artist || !payload.picked_by) { $("#pick-form-error").textContent = "Please enter a song and artist."; return; }
  const button = $("#save-pick");
  button.disabled = true;
  try {
    if (state.demo) { state.challengePicks.push({ ...payload, id: `demo-pick-${Date.now()}-${Math.random().toString(36).slice(2)}`, created_at: new Date().toISOString() }); saveDemoChallenge(); }
    else { const { error } = await state.client.from("challenge_picks").insert(payload); if (error) throw error; }
    $("#pick-dialog").close();
    await loadChallenge();
  } catch (error) { $("#pick-form-error").textContent = error.message || "Couldn’t add your pick."; }
  finally { button.disabled = false; }
}

async function ratePick(pick, score, button) {
  if (pick.owner_user_id === memberId() || ![1, 3, 5].includes(score)) return;
  const current = state.challengeRatings.find((rating) => rating.pick_id === pick.id && rating.voter_user_id === memberId());
  button.disabled = true;
  try {
    if (state.demo) {
      state.challengeRatings = state.challengeRatings.filter((rating) => rating !== current);
      if (current?.score !== score) state.challengeRatings.push({ pick_id: pick.id, voter_user_id: memberId(), score });
      saveDemoChallenge();
    } else {
      const query = state.client.from("challenge_ratings");
      const result = current?.score === score ? await query.delete().eq("pick_id", pick.id).eq("voter_user_id", memberId())
        : current ? await query.update({ score }).eq("pick_id", pick.id).eq("voter_user_id", memberId())
          : await query.insert({ pick_id: pick.id, voter_user_id: memberId(), score });
      if (result.error) throw result.error;
    }
    await loadChallenge();
  } catch (error) { challengeMessage(`Couldn’t save rating: ${error.message}`); button.disabled = false; }
}

async function removePick(pick, button) {
  if (pick.owner_user_id !== memberId()) return;
  if (!window.confirm(`Remove “${pick.title}” from your picks? Its ratings will also be removed.`)) return;
  button.disabled = true;
  try {
    if (state.demo) { state.challengePicks = state.challengePicks.filter((item) => item.id !== pick.id); state.challengeRatings = state.challengeRatings.filter((rating) => rating.pick_id !== pick.id); saveDemoChallenge(); }
    else { const { error } = await state.client.from("challenge_picks").delete().eq("id", pick.id).eq("owner_user_id", memberId()); if (error) throw error; }
    await loadChallenge();
  } catch (error) { challengeMessage(`Couldn’t remove pick: ${error.message}`); button.disabled = false; }
}

function startDemo() {
  state.demo = true;
  try { state.songs = JSON.parse(localStorage.getItem(DEMO_KEY)) || sampleSongs; }
  catch { state.songs = sampleSongs; }
  try { state.likes = JSON.parse(localStorage.getItem(DEMO_LIKES_KEY)) || []; }
  catch { state.likes = []; }
  state.memberName = localStorage.getItem("empty-threats-name") || "You";
  try { state.challengePicks = JSON.parse(localStorage.getItem(DEMO_PICKS_KEY)) || []; }
  catch { state.challengePicks = []; }
  try { state.challengeRatings = JSON.parse(localStorage.getItem(DEMO_RATINGS_KEY)) || []; }
  catch { state.challengeRatings = []; }
  $("#demo-banner").hidden = false;
  $("#challenge-demo-banner").hidden = false;
  $("#refresh").hidden = true;
  showView("board");
  renderBoard();
}

async function init() {
  document.querySelectorAll(".app-nav-button").forEach((button) => button.addEventListener("click", () => {
    if (button.dataset.view === "challenge") void openChallenge();
    else if (button.dataset.view === "gigs") openGigs();
    else showView("board");
  }));
  $("#refresh-gigs").addEventListener("click", () => { $("#gigs-frame").src = GIGS_URL; });
  $("#add-pick").addEventListener("click", () => {
    $("#pick-form").reset();
    $("#pick-form-error").textContent = "";
    $("#pick-dialog").showModal();
    $("#pick-title").focus();
  });
  $("#close-pick-dialog").addEventListener("click", () => $("#pick-dialog").close());
  $("#cancel-pick-dialog").addEventListener("click", () => $("#pick-dialog").close());
  $("#pick-form").addEventListener("submit", savePick);
  $("#refresh-challenge").addEventListener("click", () => { void loadChallenge(); });
  $("#challenge-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const pick = state.challengePicks.find((item) => item.id === button.closest(".challenge-card")?.dataset.id);
    if (!pick) return;
    if (button.dataset.action === "rate") void ratePick(pick, Number(button.dataset.score), button);
    if (button.dataset.action === "remove-pick") void removePick(pick, button);
  });
  $("#add-song").addEventListener("click", () => openSongDialog());
  $("#close-dialog").addEventListener("click", () => $("#song-dialog").close());
  $("#cancel-dialog").addEventListener("click", () => $("#song-dialog").close());
  $("#song-form").addEventListener("submit", saveSong);
  $("#search").addEventListener("input", (event) => { state.search = event.target.value; renderBoard(); });
  $("#refresh").addEventListener("click", () => { void loadSongs(); });
  document.querySelectorAll(".suggestion-order").forEach((button) => button.addEventListener("click", () => {
    if (button.dataset.order === "votes" && !state.likesReady) return;
    state.suggestionOrder = button.dataset.order;
    renderBoard();
  }));
  document.querySelectorAll(".mobile-tab").forEach((tab) => tab.addEventListener("click", () => { state.activeStage = tab.dataset.stage; renderBoard(); }));
  $(".mobile-tabs").addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const current = STAGES.indexOf(state.activeStage);
    state.activeStage = event.key === "Home" ? STAGES[0] : event.key === "End" ? STAGES[2] : STAGES[(current + (event.key === "ArrowRight" ? 1 : 2)) % 3];
    renderBoard();
    $(`.mobile-tab[data-stage="${state.activeStage}"]`).focus();
  });
  $("#board").addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const song = state.songs.find((item) => item.id === button.closest(".song-card")?.dataset.id);
    if (!song) return;
    if (button.dataset.action === "edit") openSongDialog(song);
    if (button.dataset.action === "like") void toggleLike(song, button);
    if (button.dataset.action === "move") void moveSong(song, button.dataset.to, button);
    if (button.dataset.action === "delete") void deleteSong(song, button);
  });
  const config = window.EMPTY_THREATS_CONFIG || {};
  if (!config.supabaseUrl || !config.supabasePublishableKey) { startDemo(); return; }
  if (!window.supabase?.createClient) { showView("auth"); authMessage("The Supabase library could not load. Check your connection and refresh.", "error"); return; }
  state.client = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey);
  $("#band-name").value = localStorage.getItem("empty-threats-name") || "";
  $("#join-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const code = $("#band-code").value.trim();
    const name = $("#band-name").value.trim();
    if (!name) { authMessage("Please enter your name.", "error"); return; }
    const button = event.currentTarget.querySelector("button");
    button.disabled = true;
    authMessage("Checking the band code…");
    try {
      const session = await ensureAnonymousSession();
      const { data, error } = await state.client.rpc("join_band", { p_code: code, p_name: name });
      if (error) {
        const message = /permission denied for function/i.test(error.message)
          ? "Supabase hasn’t granted access to the join function. Ask the band admin to run repair-access.sql in the SQL Editor, then try again."
          : `Couldn’t check the code: ${error.message}`;
        authMessage(message, "error");
      } else if (!data) {
        authMessage("That code didn’t match. Check it with the band admin.", "error");
      } else {
        localStorage.setItem("empty-threats-name", name);
        $("#band-code").value = "";
        await handleSession(session);
      }
    } catch (error) { authMessage(error.message || "Couldn’t connect to Supabase.", "error"); }
    finally { button.disabled = false; }
  });
  state.client.auth.onAuthStateChange((_event, session) => { if (session) setTimeout(() => { void handleSession(session); }, 0); });
  try { await handleSession(await ensureAnonymousSession()); }
  catch (error) { showView("auth"); authMessage(error.message, "error"); }
}

void init();
