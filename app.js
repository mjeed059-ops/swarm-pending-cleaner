let all = [];
let selected = new Set();

const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));

function updateStats(){
  $("#count").textContent = all.length;
  $("#selected").textContent = selected.size;
  $("#cancelSelected").disabled = selected.size === 0;
}
function showNotice(msg){
  const n = $("#notice");
  n.textContent = msg;
  n.classList.toggle("hidden", !msg);
}
function render(){
  const q = $("#search").value.trim().toLowerCase();
  const rows = all.filter(u => `${u.firstName} ${u.lastName} ${u.homeCity}`.toLowerCase().includes(q));
  $("#list").innerHTML = rows.map(u => `
    <article class="item">
      <input type="checkbox" data-id="${esc(u.id)}" ${selected.has(u.id) ? "checked":""}>
      ${u.photo ? `<img class="avatar" src="${esc(u.photo)}" alt="">` : `<div class="avatar"></div>`}
      <div>
        <div class="name">${esc([u.firstName,u.lastName].filter(Boolean).join(" ") || u.id)}</div>
        <div class="meta">${esc(u.homeCity || "No city")} · ${esc(u.relationship)}</div>
      </div>
      <button class="danger one" data-id="${esc(u.id)}">Cancel</button>
    </article>`).join("") || `<div class="card"><p>No pending outgoing requests found in the exposed API collections.</p></div>`;
  document.querySelectorAll('input[type="checkbox"][data-id]').forEach(c => c.onchange = () => {
    c.checked ? selected.add(c.dataset.id) : selected.delete(c.dataset.id);
    updateStats();
  });
  document.querySelectorAll(".one").forEach(b => b.onclick = () => cancelIds([b.dataset.id]));
  updateStats();
}

async function refresh(){
  showNotice("Checking the relationship collections exposed by your account…");
  const r = await fetch("/api/pending-sent");
  if (r.status === 401){ showNotice("Connect your Swarm/Foursquare account first."); return; }
  const data = await r.json();
  if (!r.ok){ showNotice(data.error || "Failed to load."); return; }
  all = data.items || [];
  selected.clear();
  const failed = (data.attempts || []).filter(x => !x.ok).length;
  showNotice(data.warning || (failed ? `Found ${all.length}. Some legacy collections were unavailable.` : ""));
  render();
}

async function cancelIds(ids){
  if (!ids.length) return;
  const label = ids.length === 1 ? "this request" : `${ids.length} requests`;
  if (!confirm(`Cancel ${label}? This cannot be undone automatically.`)) return;
  const r = await fetch("/api/cancel-bulk", {
    method:"POST",
    headers:{"content-type":"application/json"},
    body:JSON.stringify({ids})
  });
  const data = await r.json();
  if (!r.ok){ showNotice(data.error || "Cancel failed."); return; }
  const success = new Set((data.results || []).filter(x => x.ok).map(x => x.id));
  all = all.filter(x => !success.has(x.id));
  success.forEach(id => selected.delete(id));
  showNotice(`Cancelled ${data.cancelled} of ${data.total}.${data.failed ? ` ${data.failed} failed.`:""}`);
  render();
}

$("#login").onclick = () => location.href="/auth/login";
$("#refresh").onclick = refresh;
$("#search").oninput = render;
$("#selectAll").onclick = () => {
  const q = $("#search").value.trim().toLowerCase();
  all.filter(u => `${u.firstName} ${u.lastName} ${u.homeCity}`.toLowerCase().includes(q)).forEach(u => selected.add(u.id));
  render();
};
$("#cancelSelected").onclick = () => cancelIds([...selected]);
$("#useToken").onclick = async () => {
  const token = $("#token").value.trim();
  if (!token) return;
  const r = await fetch("/auth/token",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({token})});
  if (r.ok){ $("#token").value=""; refresh(); }
  else showNotice("Token rejected by local app.");
};