/**
 * MediaCenter LAN Chat Widget v12
 * - WebSocket auf gleichem Port wie HTTP (kein separater Port 8765 nötig)
 * - Voicechat mit LAN-Hinweis für HTTP-Geräte
 * - Ghost-Mode, VKB
 */
(function(){
'use strict';
if(document.getElementById('mc-panel'))return;
if(window._mcChat)return;
if(window.self!==window.top)return;
window._mcChat=true;

/* ── Konfiguration ──────────────────────────────────────── */
var WS_HOST=(location.hostname||'127.0.0.1').trim()||'127.0.0.1';
var WS_PORT=location.port?parseInt(location.port,10):80;
var WS_PATH='/ws-chat';
var MAX=150,NK='mc_playerName';
var ws=null,wsReady=false,collapsed=true,unread=0;
var chatName=localStorage.getItem(NK)||'';
var phase=chatName?'chat':'name';
var sid=sessionStorage.getItem('mcSid')||'';
if(!sid){sid=Math.random().toString(36).substr(2,9);sessionStorage.setItem('mcSid',sid);}
var reconnDelay=2000,reconnTimer=null,typingSent=false,typingTimer=null;
var users=[],myClientId='',voiceJoined=false,micAsked=false;
var localStream=null,peerCons={},peerAudios={},peerVolumes={},_iceQueues={};
try{peerVolumes=JSON.parse(localStorage.getItem('mc_voice_vols')||'{}')||{};}catch(e){peerVolumes={};}
var _ghostMode=localStorage.getItem('mc_ghost')==='on';
var _vkbOpen=false;

/* ── CSS ────────────────────────────────────────────────── */
var css=`
#mc-overlay{display:none;position:fixed;inset:0;z-index:6900;pointer-events:none;}
#mc-overlay.open{display:block}
#mc-panel{
  position:fixed;left:auto;top:auto;right:16px;bottom:16px;
  width:360px;height:480px;min-width:260px;min-height:240px;
  max-width:calc(100vw - 16px);max-height:calc(100vh - 16px);max-height:calc(100dvh - 16px);
  resize:both;touch-action:auto;
  display:flex;flex-direction:column;
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
  pointer-events:all;border-radius:18px;overflow:hidden;
  background:rgba(8,8,20,.97);border:1.5px solid rgba(var(--acc-rgb),.38);
  box-shadow:0 12px 50px rgba(0,0,0,.9);}
#mc-overlay.ghost-mode #mc-panel{
  opacity:0.18;transition:opacity .4s ease;
  box-shadow:0 4px 20px rgba(0,0,0,.6);border-color:rgba(var(--acc-rgb),.2);}
#mc-overlay.ghost-mode #mc-panel:hover,#mc-overlay.ghost-mode #mc-panel:focus-within,#mc-overlay.ghost-mode #mc-panel.dragging{opacity:1;transition:opacity .15s ease;}
#mc-head{display:flex;align-items:center;justify-content:space-between;
  padding:10px 14px 9px;flex-shrink:0;cursor:grab;touch-action:none;user-select:none;-webkit-user-select:none;
  background:linear-gradient(180deg,rgba(var(--acc-rgb),.1),rgba(var(--acc-rgb),.02));
  border-bottom:1px solid rgba(var(--acc-rgb),.12);}
#mc-htit{font-size:.82rem;font-weight:800;color:var(--acc);flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
#mc-htit::before{content:'⠿';opacity:.45;margin-right:6px;font-weight:400}
#mc-panel.dragging{opacity:.92;transition:none}
#mc-panel.dragging #mc-head{cursor:grabbing}
.mc-hbtn{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);
  color:rgba(255,255,255,.55);font-size:.75rem;cursor:pointer;
  padding:4px 8px;border-radius:7px;transition:.2s;line-height:1;font-family:inherit;}
.mc-hbtn:hover{background:rgba(var(--acc-rgb),.14);color:var(--acc);border-color:rgba(var(--acc-rgb),.3);}
.mc-hbtn.act{background:rgba(var(--acc-rgb),.22);color:var(--acc);border-color:rgba(var(--acc-rgb),.5);}
#mc-x{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.15);
  color:rgba(255,255,255,.6);font-size:1rem;cursor:pointer;
  padding:4px 9px;border-radius:8px;transition:.2s;line-height:1;font-family:inherit;}
#mc-x:hover{background:rgba(220,50,50,.3);color:#ff8888;border-color:rgba(220,50,50,.4);}
#mc-conn-row{display:flex;align-items:center;gap:6px;padding:4px 14px;
  font-size:.6rem;color:rgba(255,255,255,.3);border-bottom:1px solid rgba(var(--acc-rgb),.06);flex-shrink:0;}
.mc-dot{width:6px;height:6px;border-radius:50%;background:#444;flex-shrink:0;transition:.3s;}
.mc-dot.on{background:#2ecc71;box-shadow:0 0 6px rgba(46,204,113,.7);}
.mc-dot.err{background:#e74c3c;}
#mc-nsc{padding:16px;display:flex;flex-direction:column;gap:10px;}
.mc-nlbl{font-size:.75rem;color:rgba(255,255,255,.5);text-align:center;line-height:1.5}
.mc-nlbl strong{color:var(--acc)}
.mc-nrow{display:flex;gap:8px;}
#mc-ni{flex:1;padding:9px 12px;background:rgba(255,255,255,.07);
  border:1.5px solid rgba(var(--acc-rgb),.28);border-radius:10px;color:#fff;
  font-size:.85rem;outline:none;transition:.2s;font-family:inherit;}
#mc-ni:focus{border-color:var(--acc);}
#mc-ni::placeholder{color:rgba(255,255,255,.22);}
#mc-nb{padding:9px 18px;background:linear-gradient(135deg,var(--acc),var(--acc2));
  border:none;border-radius:10px;color:#000;font-size:.82rem;font-weight:900;
  cursor:pointer;white-space:nowrap;transition:.15s;font-family:inherit;}
#mc-nb:hover{transform:scale(1.04);}
#mc-msgs{overflow-y:auto;padding:10px 14px;display:flex;flex-direction:column;
  gap:5px;flex:1 1 auto;min-height:60px;
  scrollbar-width:thin;scrollbar-color:rgba(var(--acc-rgb),.15) transparent;}
#mc-msgs::-webkit-scrollbar{width:3px;}
#mc-msgs::-webkit-scrollbar-thumb{background:rgba(var(--acc-rgb),.18);border-radius:2px;}
.mc-msg{display:flex;flex-direction:column;max-width:82%;animation:mc-in .15s ease;}
@keyframes mc-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
.mc-msg.own{align-self:flex-end;align-items:flex-end;}
.mc-msg.other{align-self:flex-start;align-items:flex-start;}
.mc-mn{font-size:.6rem;font-weight:800;letter-spacing:.3px;margin-bottom:2px;padding:0 3px;}
.mc-mb{font-size:.8rem;line-height:1.45;padding:6px 10px;border-radius:11px;word-break:break-word;}
.mc-msg.own .mc-mb{background:linear-gradient(135deg,rgba(var(--acc-rgb),.18),rgba(var(--acc2-rgb),.11));
  border:1px solid rgba(var(--acc-rgb),.25);color:rgba(255,255,255,.92);border-bottom-right-radius:3px;}
.mc-msg.other .mc-mb{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.07);
  color:rgba(255,255,255,.85);border-bottom-left-radius:3px;}
.mc-sys{font-size:.62rem;color:rgba(255,255,255,.28);text-align:center;padding:3px 0;}
#mc-typing{padding:3px 14px 5px;font-size:.62rem;color:rgba(var(--acc-rgb),.4);min-height:18px;flex-shrink:0;}
.mc-users{padding:5px 12px 8px;border-top:1px solid rgba(var(--acc-rgb),.06);background:rgba(0,0,0,.2);}
.mc-users-head{font-size:.62rem;color:rgba(255,255,255,.42);margin-bottom:5px;display:flex;justify-content:space-between;}
#mc-users-list{max-height:66px;overflow-y:auto;font-size:.7rem;color:rgba(255,255,255,.82);}
.mc-user-row{display:flex;align-items:center;gap:6px;padding:2px 0;}
.mc-vdot{width:7px;height:7px;border-radius:50%;background:#555;display:inline-block;}
.mc-vdot.on{background:#2ecc71;box-shadow:0 0 6px rgba(46,204,113,.6);}
.mc-voice{padding:8px 12px;border-top:1px solid rgba(var(--acc-rgb),.08);background:rgba(0,0,0,.28);}
.mc-voice-row{display:flex;align-items:center;gap:6px;margin-bottom:6px;}
#mc-voice-dev{flex:1;min-width:0;background:rgba(255,255,255,.06);border:1px solid rgba(var(--acc-rgb),.18);color:#fff;border-radius:8px;padding:5px 8px;font-size:.72rem;}
#mc-voice-btn{padding:6px 10px;background:linear-gradient(135deg,var(--acc),var(--acc2));border:none;border-radius:8px;color:#000;font-weight:800;cursor:pointer;font-size:.72rem;}
#mc-voice-btn.off{background:rgba(255,255,255,.1);color:rgba(255,255,255,.72);border:1px solid rgba(255,255,255,.15);}
.mc-voice-note{font-size:.62rem;color:rgba(255,255,255,.45);margin-bottom:6px;}
#mc-voice-peers{max-height:90px;overflow-y:auto;}
.mc-peer{display:grid;grid-template-columns:1fr 74px;gap:7px;align-items:center;padding:3px 0;}
.mc-peer-name{font-size:.68rem;color:rgba(255,255,255,.85);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.mc-peer-vol{width:100%;}
.mc-ir{display:flex;gap:6px;padding:10px 14px;
  border-top:1px solid rgba(var(--acc-rgb),.08);background:rgba(0,0,0,.2);flex-shrink:0;}
#mc-inp{flex:1;padding:8px 12px;background:rgba(255,255,255,.07);
  border:1.5px solid rgba(var(--acc-rgb),.22);border-radius:9px;color:#fff;
  font-size:.82rem;outline:none;transition:.2s;font-family:inherit;}
#mc-inp:focus{border-color:var(--acc);}
#mc-inp::placeholder{color:rgba(255,255,255,.2);}
#mc-send{width:36px;height:36px;flex-shrink:0;
  background:linear-gradient(135deg,var(--acc),var(--acc2));border:none;border-radius:9px;
  color:#000;font-size:.9rem;font-weight:900;cursor:pointer;
  display:flex;align-items:center;justify-content:center;transition:.15s;}
#mc-send:hover{transform:scale(1.08);}
#mc-vkb{display:none;flex-direction:column;gap:4px;padding:8px 10px;
  background:rgba(0,0,0,.35);border-top:1px solid rgba(var(--acc-rgb),.08);flex-shrink:0;}
#mc-vkb.open{display:flex;}
.mc-vkb-row{display:flex;gap:4px;justify-content:center;}
.mc-vkey{padding:7px 0;border-radius:7px;border:1px solid rgba(var(--acc-rgb),.18);
  background:rgba(255,255,255,.06);color:rgba(255,255,255,.85);
  font-size:.78rem;cursor:pointer;transition:.12s;flex:1;max-width:38px;
  font-family:inherit;line-height:1;text-align:center;user-select:none;}
.mc-vkey:hover,.mc-vkey:active{background:rgba(var(--acc-rgb),.25);color:var(--acc);border-color:rgba(var(--acc-rgb),.4);}
.mc-vkey.wide{flex:2;max-width:76px;}
.mc-vkey.xwide{flex:4;max-width:none;}
.mc-vkey.act{background:rgba(var(--acc-rgb),.3);color:var(--acc);}
#mc-pill{display:none;align-items:center;gap:5px;padding:3px 9px 3px 7px;
  background:rgba(var(--acc-rgb),.08);border:1px solid rgba(var(--acc-rgb),.18);
  border-radius:20px;cursor:pointer;transition:.2s;}
#mc-pill:hover{background:rgba(var(--acc-rgb),.16);}
#mc-pill span{font-size:.68rem;font-weight:700;color:var(--acc);
  max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
@media(max-width:600px){
  #mc-panel{resize:none;min-width:0;width:calc(100vw - 16px);height:min(440px,calc(100dvh - 120px));}
  #mc-inp,#mc-ni{font-size:16px;} /* verhindert Zoom auf iPhone */
  .mc-hbtn,#mc-x{padding:7px 10px;}
  #mc-vkb-btn{display:none;} /* Handy hat eine eigene Tastatur */
}
@media(pointer:coarse) and (any-pointer:fine){#mc-vkb-btn{display:inline-block}}`;

/* ── DOM aufbauen ───────────────────────────────────────── */
var s=document.createElement('style');s.textContent=css;document.head.appendChild(s);

var overlay=document.createElement('div');overlay.id='mc-overlay';
overlay.innerHTML=`<div id="mc-panel">
<div id="mc-head">
  <span id="mc-htit" title="Zum Verschieben ziehen">💬 LAN Chat</span>
  <div style="display:flex;align-items:center;gap:5px;">
    <div id="mc-pill"><span>👤</span><span id="mc-pn"></span></div>
    <button class="mc-hbtn" id="mc-ghost-btn" title="Durchsichtig (Ghost-Mode)">📌</button>
    <button class="mc-hbtn" id="mc-vkb-btn" title="Tastatur">⌨️</button>
    <button id="mc-x" title="Schließen">✕</button>
  </div>
</div>
<div id="mc-conn-row"><div class="mc-dot" id="mc-dot"></div><span id="mc-conn-label">Verbinde…</span></div>
<div id="mc-nsc">
  <div class="mc-nlbl">Wähle einen <strong>Namen</strong> zum Mitmachen.</div>
  <div class="mc-nrow">
    <input id="mc-ni" placeholder="Dein Name…" maxlength="20" autocomplete="off">
    <button id="mc-nb">▶ Los</button>
  </div>
</div>
<div id="mc-msgs" style="display:none"></div>
<div id="mc-typing"></div>
<div class="mc-users" id="mc-users-wrap" style="display:none">
  <div class="mc-users-head"><span>Online</span><span id="mc-users-count">0</span></div>
  <div id="mc-users-list"></div>
</div>
<div class="mc-voice" id="mc-voice-wrap" style="display:none">
  <div class="mc-voice-note" id="mc-voice-note">Voicechat im gleichen LAN.</div>
  <div class="mc-voice-row">
    <select id="mc-voice-dev"></select>
    <button id="mc-voice-btn" class="off">🎤 Start</button>
  </div>
  <div id="mc-voice-peers"></div>
</div>
<div id="mc-iw" style="display:none">
  <div class="mc-ir">
    <input id="mc-inp" placeholder="Nachricht…" maxlength="300" autocomplete="off">
    <button id="mc-send">➤</button>
  </div>
</div>
<div id="mc-vkb"></div>
</div>`;
document.documentElement.appendChild(overlay);

/* ── DOM-Referenzen ─────────────────────────────────────── */
var pan=document.getElementById('mc-panel');
var xBtn=document.getElementById('mc-x');
var niEl=document.getElementById('mc-ni');
var nbEl=document.getElementById('mc-nb');
var inpEl=document.getElementById('mc-inp');
var sendEl=document.getElementById('mc-send');
var dot=document.getElementById('mc-dot');
var connLabel=document.getElementById('mc-conn-label');
var msgs=document.getElementById('mc-msgs');
var nsc=document.getElementById('mc-nsc');
var iw=document.getElementById('mc-iw');
var pill=document.getElementById('mc-pill');
var pn=document.getElementById('mc-pn');
var typEl=document.getElementById('mc-typing');
var usersWrap=document.getElementById('mc-users-wrap');
var usersList=document.getElementById('mc-users-list');
var usersCount=document.getElementById('mc-users-count');
var voiceWrap=document.getElementById('mc-voice-wrap');
var voiceDev=document.getElementById('mc-voice-dev');
var voiceBtn=document.getElementById('mc-voice-btn');
var voicePeers=document.getElementById('mc-voice-peers');
var voiceNote=document.getElementById('mc-voice-note');
var ghostBtn=document.getElementById('mc-ghost-btn');
var vkbBtn=document.getElementById('mc-vkb-btn');
var vkbEl=document.getElementById('mc-vkb');

/* ── Hilfsfunktionen ────────────────────────────────────── */
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function scrollB(){requestAnimationFrame(function(){msgs.scrollTop=msgs.scrollHeight;});}

function showPhase(p){
  phase=p;
  nsc.style.display=p==='name'?'':'none';
  msgs.style.display=p==='chat'?'':'none';
  iw.style.display=p==='chat'?'':'none';
  typEl.style.display=p==='chat'?'':'none';
  usersWrap.style.display=p==='chat'?'':'none';
  voiceWrap.style.display=p==='chat'?'':'none';
  if(pill)pill.style.display=p==='chat'?'flex':'none';
  if(p==='chat'&&pn)pn.textContent=chatName;
  if(p==='chat')scrollB();
}

function renderUsers(){
  if(!usersList)return;
  var safe=(users||[]).slice();
  usersCount.textContent=String(safe.length);
  usersList.innerHTML=safe.map(function(u){
    var me=u.id===myClientId?' (du)':'';
    return '<div class="mc-user-row"><span class="mc-vdot '+(u.isVoice?'on':'')+'"></span><span>'+esc(u.name||'?')+me+'</span></div>';
  }).join('');
  renderVoicePeers();
}

function savePeerVolumes(){try{localStorage.setItem('mc_voice_vols',JSON.stringify(peerVolumes||{}));}catch(e){}}
function renderVoicePeers(){
  if(!voicePeers)return;
  var peers=(users||[]).filter(function(u){return u.isVoice&&u.id!==myClientId;});
  voicePeers.innerHTML=peers.map(function(u){
    var v=peerVolumes[u.id];if(typeof v!=='number')v=1;
    return '<div class="mc-peer"><div class="mc-peer-name">🔊 '+esc(u.name||u.id)+'</div>'
      +'<input class="mc-peer-vol" type="range" min="0" max="1" step="0.05" value="'+v+'" data-peer="'+esc(u.id)+'"></div>';
  }).join('');
  voicePeers.querySelectorAll('.mc-peer-vol').forEach(function(sl){
    sl.addEventListener('input',function(){
      var pid=this.getAttribute('data-peer'),vol=+this.value;
      peerVolumes[pid]=vol;savePeerVolumes();
      if(peerAudios[pid])peerAudios[pid].volume=vol;
    });
  });
}

function setVoiceBtn(on){
  voiceJoined=!!on;
  if(voiceBtn){voiceBtn.textContent=on?'🛑 Stop':'🎤 Start';voiceBtn.classList.toggle('off',!on);}
  if(voiceNote){
    voiceNote.textContent=on
      ?'Voicechat aktiv. Lautstärke pro Sprecher lokal regelbar.'
      :'Voicechat im gleichen LAN. Auf Smartphones: Chrome-Flag nötig (siehe Hilfe).';
  }
}

/* ── Mikrofon-Berechtigung ──────────────────────────────── */
async function ensureMicPermission(silent){
  if(localStream&&localStream.active)return true;
  // getUserMedia erfordert HTTPS oder localhost.
  // Für HTTP im LAN: In Chrome chrome://flags/#unsafely-treat-insecure-origin-as-secure
  // die Serveradresse eintragen, dann Neustart.
  if(location.protocol==='http:'&&location.hostname!=='localhost'&&location.hostname!=='127.0.0.1'){
    if(!silent){
      alert('⚠️ Mikrofon über HTTP im LAN:\n\nChrome/Edge: Öffne\nchrome://flags/#unsafely-treat-insecure-origin-as-secure\nund trage "http://'+location.host+'" ein.\nDann Browser neu starten.');
    }
  }
  try{
    var pref=(voiceDev&&voiceDev.value)?{deviceId:{exact:voiceDev.value}}:undefined;
    localStream=await navigator.mediaDevices.getUserMedia({audio:pref||true,video:false});
    micAsked=true;return true;
  }catch(ex){
    if(!silent){
      if(ex.name==='NotAllowedError'||ex.name==='PermissionDeniedError'){
        alert('Mikrofon verweigert.\nAuf Smartphones: Schloss-Symbol in Adressleiste → Mikrofon erlauben.');
      }else{
        alert('Mikrofon-Fehler: '+ex.message);
      }
    }
    return false;
  }
}

async function loadMicDevices(){
  if(!navigator.mediaDevices||!navigator.mediaDevices.enumerateDevices)return;
  try{
    var devs=await navigator.mediaDevices.enumerateDevices();
    var aud=devs.filter(function(d){return d.kind==='audioinput';});
    if(voiceDev){
      voiceDev.innerHTML=aud.map(function(d,i){
        return '<option value="'+esc(d.deviceId||'')+'">'+esc(d.label||('Mikrofon '+(i+1)))+'</option>';
      }).join('')||'<option value="">Standard-Mikrofon</option>';
    }
  }catch(ex){}
}

function cleanupPeer(pid){
  try{if(peerCons[pid])peerCons[pid].close();}catch(ex){}
  delete peerCons[pid];
  delete _iceQueues[pid];
  if(peerAudios[pid]){try{peerAudios[pid].srcObject=null;}catch(ex){}delete peerAudios[pid];}
}
function cleanupVoiceAll(sendLeave){
  Object.keys(peerCons).forEach(cleanupPeer);
  if(localStream){localStream.getTracks().forEach(function(t){try{t.stop();}catch(ex){}});localStream=null;}
  if(sendLeave&&wsReady)ws.send(JSON.stringify({action:'voice_leave'}));
  setVoiceBtn(false);
}

function rtcCfg(){return {
  iceServers:[
    {urls:'stun:stun.l.google.com:19302'},
    {urls:'stun:stun1.l.google.com:19302'},
    {urls:'stun:stun.cloudflare.com:3478'},
  ],
  iceCandidatePoolSize:4,
  iceTransportPolicy:'all',
};}

function wsSignal(targetId,signalType,payload){
  if(!wsReady)return;
  ws.send(JSON.stringify({action:'voice_signal',targetId:targetId,signalType:signalType,payload:payload||null}));
}

function ensurePeer(pid){
  if(peerCons[pid])return peerCons[pid];
  var pc=new RTCPeerConnection(rtcCfg());
  peerCons[pid]=pc;
  if(localStream)localStream.getTracks().forEach(function(t){pc.addTrack(t,localStream);});
  pc.onicecandidate=function(e){if(e.candidate)wsSignal(pid,'ice',e.candidate);};
  pc.ontrack=function(e){
    var au=peerAudios[pid]||new Audio();
    peerAudios[pid]=au;au.autoplay=true;au.playsInline=true;
    au.srcObject=e.streams[0];
    au.volume=typeof peerVolumes[pid]==='number'?peerVolumes[pid]:1;
  };
  pc.onconnectionstatechange=function(){
    if(pc.connectionState==='failed'||pc.connectionState==='closed'||pc.connectionState==='disconnected')cleanupPeer(pid);
  };
  return pc;
}

// Nur der neue Teilnehmer initiiert (schickt Offer) — verhindert Offer-Kollision
async function connectToPeer(pid){
  if(!voiceJoined||!localStream)return;
  var pc=ensurePeer(pid);
  if(pc.signalingState!=='stable')return; // bereits in Verhandlung
  try{
    var offer=await pc.createOffer({offerToReceiveAudio:true,offerToReceiveVideo:false});
    await pc.setLocalDescription(offer);
    wsSignal(pid,'offer',offer);
  }catch(ex){}
}

async function handleVoiceSignal(d){
  var pid=d.fromId;if(!pid)return;
  if(!voiceJoined||!localStream)return;
  try{
    if(d.signalType==='offer'&&d.payload){
      // Bestehender Peer empfängt Offer vom neuen Teilnehmer → antwortet mit Answer
      var pc=ensurePeer(pid);
      await pc.setRemoteDescription(new RTCSessionDescription(d.payload));
      // Aufgestaute ICE-Kandidaten jetzt anwenden
      var q=_iceQueues[pid]||[];delete _iceQueues[pid];
      for(var i=0;i<q.length;i++){try{await pc.addIceCandidate(new RTCIceCandidate(q[i]));}catch(ex){}}
      var ans=await pc.createAnswer();
      await pc.setLocalDescription(ans);
      wsSignal(pid,'answer',ans);

    }else if(d.signalType==='answer'&&d.payload){
      var pc=peerCons[pid];if(!pc)return;
      await pc.setRemoteDescription(new RTCSessionDescription(d.payload));
      // Aufgestaute ICE-Kandidaten anwenden
      var q=_iceQueues[pid]||[];delete _iceQueues[pid];
      for(var i=0;i<q.length;i++){try{await pc.addIceCandidate(new RTCIceCandidate(q[i]));}catch(ex){}}

    }else if(d.signalType==='ice'&&d.payload){
      var pc=peerCons[pid];
      if(pc&&pc.remoteDescription&&pc.remoteDescription.type){
        // Remote Description bereits gesetzt → direkt anwenden
        try{await pc.addIceCandidate(new RTCIceCandidate(d.payload));}catch(ex){}
      }else{
        // Remote Description noch nicht gesetzt → Kandidat in Queue puffern
        if(!_iceQueues[pid])_iceQueues[pid]=[];
        _iceQueues[pid].push(d.payload);
      }
    }
  }catch(ex){}
}

function updBadges(n){
  var qb=document.getElementById('qa-chat-badge');
  if(qb){qb.textContent=n>0?(n>99?'99+':String(n)):'';qb.style.display=n>0?'inline-block':'none';}
  document.querySelectorAll('.mc-ext-badge').forEach(function(b){
    b.textContent=n>0?(n>99?'99+':String(n)):'';b.style.display=n>0?'inline-block':'none';
  });
}
function setConnStatus(ok){
  dot.className='mc-dot'+(ok?' on':' err');
  connLabel.textContent=ok?'Verbunden':'Getrennt – Verbinde...';
  var ci=document.querySelector('#qa-chat-btn .qa-chat-icon');
  if(ci)ci.style.filter=ok?'drop-shadow(0 0 4px rgba(46,204,113,.6))':'';
}

function addMsg(m,silent){
  var own=(m.username||m.name||m.user)===chatName;
  var name=m.username||m.name||m.user||'?';
  var text=m.message||m.text||'';
  var color=m.color||'var(--acc)';
  var d=document.createElement('div');d.className='mc-msg '+(own?'own':'other');
  d.innerHTML='<div class="mc-mn" style="color:'+esc(color)+'">'+esc(name)+'</div>'
    +'<div class="mc-mb">'+esc(text)+'</div>';
  msgs.appendChild(d);
  while(msgs.childElementCount>MAX)msgs.firstElementChild.remove();
  if(collapsed&&!silent&&!own){
    unread++;updBadges(unread);
    var bar=document.getElementById('qa-bar');
    var qn=document.getElementById('qa-chat-notify');
    var qnc=document.getElementById('qa-notify-count');
    if(bar)bar.classList.add('has-notify');
    if(qn)qn.classList.add('show');
    if(qnc)qnc.textContent=unread;
  }else if(!collapsed&&phase==='chat')scrollB();
}
function addSys(t){
  var d=document.createElement('div');d.className='mc-sys';d.textContent=t;
  msgs.appendChild(d);if(!collapsed&&phase==='chat')scrollB();
}

/* ── Ghost-Mode ─────────────────────────────────────────── */
function applyGhost(){
  overlay.classList.toggle('ghost-mode',_ghostMode);
  if(ghostBtn)ghostBtn.classList.toggle('act',_ghostMode);
}
applyGhost();
ghostBtn.addEventListener('click',function(){
  _ghostMode=!_ghostMode;
  localStorage.setItem('mc_ghost',_ghostMode?'on':'off');
  applyGhost();
});

/* ── On-Screen Keyboard ─────────────────────────────────── */
var _shift=false,_caps=false,_sym=false;
var ROWS_ALPHA=[
  ['1','2','3','4','5','6','7','8','9','0'],
  ['q','w','e','r','t','z','u','i','o','p'],
  ['a','s','d','f','g','h','j','k','l'],
  ['⇧','y','x','c','v','b','n','m','⌫'],
  ['?123','_SPACE_','↵']
];
var ROWS_SYM=[
  ['!','@','#','$','%','&','*','(',')','-'],
  ['+','=','/','\\','|','<','>','"',"'",'`'],
  [';',':',',','.','?','!','~','[',']'],
  ['ABC','_SPACE_','⌫','↵']
];
function vkbRows(){return _sym?ROWS_SYM:ROWS_ALPHA;}
function vkbRender(){
  vkbEl.innerHTML='';
  vkbRows().forEach(function(row){
    var div=document.createElement('div');div.className='mc-vkb-row';
    row.forEach(function(k){
      var btn=document.createElement('button');btn.className='mc-vkey';
      var label=k;
      if(k==='_SPACE_'){label='LEER';btn.classList.add('xwide');}
      else if(k==='⌫'||k==='↵'||k==='⇧'||k==='?123'||k==='ABC'){btn.classList.add('wide');}
      if(k==='⇧'&&(_shift||_caps))btn.classList.add('act');
      if((_shift||_caps)&&k.length===1)label=k.toUpperCase();
      btn.textContent=label;
      btn.addEventListener('mousedown',function(e){e.preventDefault();vkbKey(k);});
      btn.addEventListener('touchstart',function(e){e.preventDefault();vkbKey(k);},{passive:false});
      div.appendChild(btn);
    });
    vkbEl.appendChild(div);
  });
}
function vkbKey(k){
  var target=inpEl;if(!target)return;
  if(k==='⌫'){
    var s=target.selectionStart,e2=target.selectionEnd;
    if(s!==e2)target.value=target.value.slice(0,s)+target.value.slice(e2);
    else if(s>0){target.value=target.value.slice(0,s-1)+target.value.slice(s);}
    target.selectionStart=target.selectionEnd=Math.max(0,s-1);
  }else if(k==='↵'){window.mcSend();
  }else if(k==='_SPACE_'){_ins(target,' ');
  }else if(k==='⇧'){_shift=!_shift;vkbRender();return;
  }else if(k==='?123'){_sym=true;vkbRender();return;
  }else if(k==='ABC'){_sym=false;vkbRender();return;
  }else{
    var ch=(_shift||_caps)&&k.length===1?k.toUpperCase():k;
    _ins(target,ch);
    if(_shift&&!_caps){_shift=false;vkbRender();}
  }
  target.dispatchEvent(new Event('input',{bubbles:true}));
}
function _ins(el,ch){
  var s=el.selectionStart,e2=el.selectionEnd;
  el.value=el.value.slice(0,s)+ch+el.value.slice(e2);
  el.selectionStart=el.selectionEnd=s+ch.length;
}
function vkbToggle(){
  _vkbOpen=!_vkbOpen;
  vkbEl.classList.toggle('open',_vkbOpen);
  vkbBtn.classList.toggle('act',_vkbOpen);
  if(_vkbOpen)vkbRender();
}
vkbBtn.addEventListener('click',vkbToggle);

/* ── Panel öffnen/schließen ─────────────────────────────── */
function openPanel(){
  collapsed=false;
  overlay.classList.add('open');
  var qb=document.getElementById('qa-chat-btn');if(qb)qb.classList.add('active');
  unread=0;updBadges(0);
  var bar=document.getElementById('qa-bar');if(bar)bar.classList.remove('has-notify');
  var qn=document.getElementById('qa-chat-notify');if(qn)qn.classList.remove('show');
  showPhase(chatName?'chat':'name');
  placePanel();
  // Nur am PC automatisch ins Eingabefeld – auf dem Handy würde sonst sofort die Tastatur aufspringen
  if(!IS_TOUCH)setTimeout(function(){try{(chatName?inpEl:niEl).focus({preventScroll:true});}catch(e){}},120);
}
function closePanel(){
  collapsed=true;overlay.classList.remove('open');
  var qb=document.getElementById('qa-chat-btn');if(qb)qb.classList.remove('active');
}
function doToggle(){if(collapsed)openPanel();else closePanel();}
window.mcToggleChat=doToggle;
document.addEventListener('keydown',function(e){if(e.key==='Escape'&&!collapsed&&pan.contains(document.activeElement)){closePanel();}});

/* ── Frei verschiebbar (Maus & Touch) + Größe merken ───── */
var IS_TOUCH=matchMedia('(pointer: coarse)').matches&&!matchMedia('(any-pointer: fine)').matches;
var RECT_KEY='mc_chat_rect';
function loadRect(){try{return JSON.parse(localStorage.getItem(RECT_KEY)||'null');}catch(e){return null;}}
function saveRect(){
  var r=pan.getBoundingClientRect();
  var o={x:r.left/innerWidth,y:r.top/innerHeight};
  if(!IS_TOUCH&&innerWidth>600){o.w=Math.round(r.width);o.h=Math.round(r.height);}
  try{localStorage.setItem(RECT_KEY,JSON.stringify(o));}catch(e){}
}
function viewport(){
  var vv=window.visualViewport;
  return vv?{x:vv.offsetLeft,y:vv.offsetTop,w:vv.width,h:vv.height}:{x:0,y:0,w:innerWidth,h:innerHeight};
}
function clampTo(x,y){
  var v=viewport(),r=pan.getBoundingClientRect(),m=8;
  x=Math.min(Math.max(x,v.x+m),v.x+v.w-r.width-m);
  y=Math.min(Math.max(y,v.y+m),v.y+v.h-Math.min(r.height,v.h-2*m)-m);
  pan.style.left=Math.round(Math.max(v.x+m,x))+'px';
  pan.style.top=Math.round(Math.max(v.y+m,y))+'px';
  pan.style.right='auto';pan.style.bottom='auto';
}
function placePanel(){
  var o=loadRect();
  if(o&&o.w&&innerWidth>600){pan.style.width=Math.min(o.w,innerWidth-16)+'px';pan.style.height=Math.min(o.h,innerHeight-16)+'px';}
  else if(innerWidth<=600){pan.style.width='';pan.style.height='';}
  var r=pan.getBoundingClientRect();
  if(o)clampTo(o.x*innerWidth,o.y*innerHeight);
  else clampTo(innerWidth-r.width-16,innerHeight-r.height-(innerWidth<=600?96:70));
}
(function(){
  var head=document.getElementById('mc-head'),drag=null;
  head.addEventListener('pointerdown',function(e){
    if(e.button>0||e.target.closest('button,input,select,#mc-pill'))return;
    var r=pan.getBoundingClientRect();
    drag={dx:e.clientX-r.left,dy:e.clientY-r.top,id:e.pointerId};
    pan.classList.add('dragging');
    try{head.setPointerCapture(e.pointerId);}catch(ex){}
    e.preventDefault();
  });
  head.addEventListener('pointermove',function(e){
    if(!drag||e.pointerId!==drag.id)return;
    clampTo(e.clientX-drag.dx,e.clientY-drag.dy);
  });
  function end(e){
    if(!drag||e.pointerId!==drag.id)return;
    drag=null;pan.classList.remove('dragging');saveRect();
  }
  head.addEventListener('pointerup',end);
  head.addEventListener('pointercancel',end);
  // Doppelklick auf die Titelleiste: Position zurücksetzen
  head.addEventListener('dblclick',function(e){if(e.target.closest('button,#mc-pill'))return;try{localStorage.removeItem(RECT_KEY);}catch(ex){}pan.style.width='';pan.style.height='';placePanel();});
  // Größe (Anfasser unten rechts) merken
  if(window.ResizeObserver){var rt=0;new ResizeObserver(function(){if(collapsed||drag)return;clearTimeout(rt);rt=setTimeout(saveRect,300);}).observe(pan);}
  window.addEventListener('resize',function(){if(!collapsed){var r=pan.getBoundingClientRect();clampTo(r.left,r.top);}});
})();

/* ── Event-Listener ─────────────────────────────────────── */
xBtn.addEventListener('click',function(e){e.stopPropagation();closePanel();});
xBtn.addEventListener('touchend',function(e){e.preventDefault();e.stopPropagation();closePanel();},{passive:false});
nbEl.addEventListener('click',function(){window.mcSubmitName();});
niEl.addEventListener('keydown',function(e){if(e.key==='Enter')window.mcSubmitName();});
inpEl.addEventListener('keydown',function(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();window.mcSend();}});
inpEl.addEventListener('input',function(){window.mcTypingSignal();});
sendEl.addEventListener('click',function(){window.mcSend();});

/* ── Öffentliche Funktionen ─────────────────────────────── */
window.mcSubmitName=function(){
  var v=(niEl.value||'').trim();if(!v){niEl.focus();return;}
  chatName=v;localStorage.setItem(NK,chatName);
  showPhase('chat');addSys('👋 Willkommen, '+chatName+'!');joinChat();renderUsers();
};
window.mcChangeName=function(){
  var n=prompt('Neuer Name:',chatName);if(!n||!n.trim())return;
  chatName=n.trim();localStorage.setItem(NK,chatName);
  if(pn)pn.textContent=chatName;addSys('✏️ Name: '+chatName);
};
window.mcSend=function(){
  var txt=(inpEl.value||'').trim();if(!txt||!wsReady||!chatName)return;
  ws.send(JSON.stringify({action:'global_chat',sessionId:sid,message:txt,name:chatName}));
  inpEl.value='';
};
window.mcTypingSignal=function(){
  if(!wsReady||!chatName||typingSent)return;
  typingSent=true;
  ws.send(JSON.stringify({action:'typing',name:chatName}));
  setTimeout(function(){typingSent=false;},2000);
};
if(pill)pill.addEventListener('click',function(){window.mcChangeName();});

/* ── WebSocket ──────────────────────────────────────────── */
function connect(){
  clearTimeout(reconnTimer);
  try{
    ws=new WebSocket('ws://'+WS_HOST+':'+WS_PORT+WS_PATH);
    ws.onopen=function(){
      setConnStatus(true);wsReady=true;reconnDelay=2000;
      if(chatName)joinChat();
      if(voiceJoined)setVoiceBtn(false);
    };
    ws.onclose=function(){
      setConnStatus(false);wsReady=false;
      reconnTimer=setTimeout(connect,reconnDelay);
      reconnDelay=Math.min(reconnDelay*1.5,15000);
    };
    ws.onerror=function(){setConnStatus(false);wsReady=false;};
    ws.onmessage=function(e){
      try{
        var d=JSON.parse(e.data);
        if(d.action==='theme'&&window.MCTheme)MCTheme.receive(d.theme);
        if(d.action==='global_chat_message')addMsg(d);
        if(d.action==='global_chat_history'){(d.messages||[]).forEach(function(m){addMsg(m,true);});scrollB();}
        if(d.action==='typing'&&d.name&&d.name!==chatName){
          typEl.textContent=d.name+' schreibt…';clearTimeout(typingTimer);
          typingTimer=setTimeout(function(){typEl.textContent='';},2500);
        }
        if(d.action==='welcome'&&d.id){myClientId=d.id;renderUsers();}
        if(d.action==='chat_users'){users=d.users||[];renderUsers();}
        if(d.action==='voice_peers'){(d.peers||[]).forEach(function(p){connectToPeer(p.id);});}
        // voice_user_joined: KEIN connectToPeer hier! Nur der neue Teilnehmer initiiert.
        // Der bestehende Peer wartet auf das Offer und antwortet mit Answer (in handleVoiceSignal).
        if(d.action==='voice_user_joined')renderUsers();
        if(d.action==='voice_user_left'&&d.userId)cleanupPeer(d.userId);
        if(d.action==='voice_signal')handleVoiceSignal(d);
      }catch(ex){}
    };
  }catch(ex){setConnStatus(false);wsReady=false;reconnTimer=setTimeout(connect,reconnDelay);}
}
function joinChat(){
  if(!wsReady||!chatName)return;
  ws.send(JSON.stringify({action:'global_chat_join',sessionId:sid,name:chatName}));
}

/* ── Voice-Button ───────────────────────────────────────── */
if(voiceBtn)voiceBtn.addEventListener('click',async function(){
  if(voiceJoined){cleanupVoiceAll(true);return;}
  if(!wsReady||!chatName){alert('Bitte erst dem Chat beitreten.');return;}
  var ok=await ensureMicPermission(false);
  if(!ok)return;
  await loadMicDevices();
  if(voiceDev&&voiceDev.value&&localStream){
    try{
      var newStream=await navigator.mediaDevices.getUserMedia({audio:{deviceId:{exact:voiceDev.value}},video:false});
      localStream.getTracks().forEach(function(t){t.stop();});
      localStream=newStream;
    }catch(ex){}
  }
  setVoiceBtn(true);
  ws.send(JSON.stringify({action:'voice_join'}));
});
if(voiceDev)voiceDev.addEventListener('change',function(){if(voiceJoined)cleanupVoiceAll(true);});
if(navigator.mediaDevices&&navigator.mediaDevices.addEventListener){
  navigator.mediaDevices.addEventListener('devicechange',function(){loadMicDevices();});
}

/* ── Storage/Unload ─────────────────────────────────────── */
window.addEventListener('storage',function(e){
  if(e.key!==NK||!e.newValue||e.newValue===chatName)return;
  chatName=e.newValue;
  if(phase==='chat'&&pn)pn.textContent=chatName;
  else{showPhase('chat');joinChat();}
});
window.addEventListener('beforeunload',function(){cleanupVoiceAll(true);});

if(window.visualViewport){
  window.visualViewport.addEventListener('resize',function(){
    if(collapsed)return;
    pan.style.maxHeight=Math.max(200,window.visualViewport.height-16)+'px';
    var r=pan.getBoundingClientRect();clampTo(r.left,r.top);
  });
}

/* ── Init ───────────────────────────────────────────────── */
showPhase(chatName?'chat':'name');
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',connect);
else connect();

})(); // end IIFE
