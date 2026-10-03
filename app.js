"use strict";

const STAGES = ["suggestions", "practice", "ready"];
const DEMO_KEY = "empty-threats-demo-songs-v1";
const LINK_LABEL = "Song link: ";
const state = { client: null, session: null, demo: false, songs: [], activeStage: "suggestions", search: "", editingId: null, channel: null, sessionVersion: 0 };
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
}

function boardMessage(message = "") { $("#board-message").textContent = message; }
function authMessage(message = "", kind = "") {
  const element = $("#auth-message");
  element.textContent = message;
  element.className = `form-message ${kind}`;
}

function cardHtml(song) {
  const index = STAGES.indexOf(song.stage);
  const { text: notes, link } = unpackSongNotes(song.notes);
  const service = link ? songLinkService(link) : null;
  const back = index > 0 ? `<button class="move-button back" type="button" data-action="move" data-to="${STAGES[index - 1]}" aria-label="Move ${escapeHtml(song.title)} back to ${index === 1 ? "Suggestions" : "To Be Practiced"}">← ${index === 1 ? "Suggestions" : "Practice"}</button>` : "";
  const forward = index < 2 ? `<button class="move-button forward" type="button" data-action="move" data-to="${STAGES[index + 1]}" aria-label="Move ${escapeHtml(song.title)} to ${index === 0 ? "To Be Practiced" : "Gig Ready"}">${index === 0 ? "To be practiced" : "Gig ready"} →</button>` : "";
  return `<article class="song-card" data-id="${escapeHtml(song.id)}">
    <div class="card-top"><div><h3>${escapeHtml(song.title)}</h3><p class="artist">${escapeHtml(song.artist)}</p></div>
      <div class="card-tools"><button class="card-tool" type="button" data-action="edit" title="Edit song" aria-label="Edit ${escapeHtml(song.title)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4L16.5 3.5Z"></path></svg></button><button class="card-tool delete" type="button" data-action="delete" title="Delete song" aria-label="Delete ${escapeHtml(song.title)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 3h4M6 7l1 14h10l1-14M10 11v6M14 11v6"></path></svg></button></div></div>
    ${notes ? `<p class="song-notes">${escapeHtml(notes)}</p>` : ""}
    ${service ? `<a class="song-link" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer" aria-label="${service === "YouTube" ? "Watch" : "Listen to"} ${escapeHtml(song.title)} on ${service} (opens in a new tab)">${service === "YouTube" ? "Watch on YouTube" : "Listen on Spotify"} <span aria-hidden="true">↗</span></a>` : ""}
    <div class="song-meta"><span class="suggested-by">Suggested by <strong>${escapeHtml(song.suggested_by)}</strong></span><span class="song-date">${escapeHtml(formatDate(song.created_at))}</span></div>
    <div class="card-actions">${back}${forward}</div>
  </article>`;
}

function renderBoard() {
  const term = state.search.trim().toLocaleLowerCase();
  $("#total-count").textContent = state.songs.length;
  for (const stage of STAGES) {
    const all = state.songs.filter((song) => song.stage === stage);
    const visible = term ? all.filter((song) => [song.title, song.artist, song.suggested_by, song.notes].some((value) => String(value || "").toLocaleLowerCase().includes(term))) : all;
    document.querySelectorAll(`[data-count="${stage}"]`).forEach((element) => { element.textContent = all.length; });
    $(`[data-list="${stage}"]`).innerHTML = visible.length
      ? visible.map(cardHtml).join("")
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

async function loadSongs() {
  if (state.demo) { renderBoard(); return; }
  const { data, error } = await state.client.from("songs").select("id,title,artist,suggested_by,notes,stage,created_at,updated_at").order("updated_at", { ascending: false });
  if (error) { boardMessage(`Couldn’t load songs: ${error.message}`); return; }
  state.songs = data || [];
  boardMessage();
  renderBoard();
}

function removeChannel() {
  if (state.channel) { state.client.removeChannel(state.channel); state.channel = null; }
}

function subscribeToSongs() {
  removeChannel();
  state.channel = state.client.channel("empty-threats-songs").on("postgres_changes", { event: "*", schema: "public", table: "songs" }, () => { void loadSongs(); }).subscribe();
}

async function handleSession(session) {
  const version = ++state.sessionVersion;
  state.session = session;
  removeChannel();
  if (!session) { showView("auth"); authMessage(); return; }
  const { data, error } = await state.client.from("band_members").select("user_id,display_name").eq("user_id", session.user.id).maybeSingle();
  if (version !== state.sessionVersion) return;
  if (error || !data) {
    showView("auth");
    authMessage(error ? `Couldn’t check band access: ${error.message}` : "");
    return;
  }
  if (data.display_name) localStorage.setItem("empty-threats-name", data.display_name);
  authMessage();
  showView("board");
  await loadSongs();
  if (version === state.sessionVersion) subscribeToSongs();
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

async function deleteSong(song, button) {
  if (!window.confirm(`Delete “${song.title}” by ${song.artist}? This can’t be undone.`)) return;
  button.disabled = true;
  try {
    if (state.demo) { state.songs = state.songs.filter((item) => item.id !== song.id); saveDemo(); }
    else {
      const { error } = await state.client.from("songs").delete().eq("id", song.id);
      if (error) throw error;
    }
    await loadSongs();
  } catch (error) { boardMessage(`Couldn’t delete song: ${error.message}`); button.disabled = false; }
}

function startDemo() {
  state.demo = true;
  try { state.songs = JSON.parse(localStorage.getItem(DEMO_KEY)) || sampleSongs; }
  catch { state.songs = sampleSongs; }
  $("#demo-banner").hidden = false;
  $("#refresh").hidden = true;
  showView("board");
  renderBoard();
}

async function init() {
  $("#add-song").addEventListener("click", () => openSongDialog());
  $("#close-dialog").addEventListener("click", () => $("#song-dialog").close());
  $("#cancel-dialog").addEventListener("click", () => $("#song-dialog").close());
  $("#song-form").addEventListener("submit", saveSong);
  $("#search").addEventListener("input", (event) => { state.search = event.target.value; renderBoard(); });
  $("#refresh").addEventListener("click", () => { void loadSongs(); });
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
