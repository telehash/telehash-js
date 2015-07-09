var crypto = require("crypto")
var lob = require('lob-enc');
var handshake_collect = require("./handshake").collect;

module.exports = {
  handshake : receive_handshake,
  channel   : receive_channel,
  type      : receive_type,
  decloak   : receive_decloak,
  Log       : importlog
}

var log = {}
function importlog(l){
  log = l;
}

function receive_type(packet, pipe){

  if(!packet || !pipe)
    return new Error('invalid mesh.receive args',typeof packet,typeof pipe);


  return (packet.head.length === 0) ? "channel"
       : (packet.head.length === 1) ? "handshake"
       : "unknown";

}

function receive_decloak(packet, pipe){
  if(!lob.isPacket(packet) && !(packet = lob.decloak(packet)))
    return new Error('invalid packet ' + typeof packet);

  if(packet.cloaked)
    pipe.cloaked = true;

  return packet;
}


function receive_channel(mesh, packet, pipe){
  var token = packet.body.slice(0,16).toString('hex');
  var link = mesh.index[token];
  if(!link)
  {
    var route = mesh.routes[token];
    if(route)
    {
      log.debug('routing packet to',route.path);
      var dupid = crypto.createHash('sha256').update(packet).digest('hex');
      if(dedup[dupid]) return log.debug('dropping duplicate');
      dedup[dupid] = true;
      return route.send(packet, undefined, function(){});
    }
    log.debug('dropping unknown channel packet to',token);
    return;
  }
  var inner = link.x.receive(packet);
  if(!inner)
  {
    log.debug('error receiving channel packet',link.x.err);
    return;
  }

  // this pipe is valid, if it hasn't been seen yet, we need to resync
  if(!link.seen[pipe.uid])
  {
    log.debug('never seen pipe',pipe.uid,pipe.path)
    link.addPipe(pipe,true); // must see it first
    process.nextTick(link.sync); // full resync in the background
  }

  // if channel exists, handle it
  var chan = link.x.channels[inner.json.c];
  if(chan)
  {
    if(chan.state == 'gone') return log.debug('incoming channel is gone');
    return chan.receive(inner);
  }

  // new channel open, valid?
  if(inner.json.err || typeof inner.json.type != 'string') return log.debug('invalid channel open',inner.json,link.hashname);

  // do we handle this type
  log.debug('new channel open',inner.json);

  // error utility for any open handler problems
  function bouncer(err)
  {
    if(!err) return;
    var json = {err:err};
    json.c = inner.json.c;
    log.debug('bouncing open',json);
    link.x.send({json:json});
  }

  // check all the extensions for any handlers of this type
  var args = {pipe:pipe};
  for(var i=0;i<mesh.extended.length;i++)
  {
    if(typeof mesh.extended[i].open != 'object') continue;
    var handler = mesh.extended[i].open[inner.json.type];
    if(typeof handler != 'function') continue;
    // set the link to be 'this' and be done
    handler.call(link, args, inner, bouncer);
    return;
  }

  // default bounce if not handled
  return bouncer('unknown type');

};

// cache incoming handshakes to aggregate them
var hcache = {};
setInterval(function hcachet(){hcache={}},60*1000);

function receive_handshake(mesh, packet, pipe){
  var inner = mesh.self.decrypt(packet);
  if(!inner)
  {
    log.debug('message decryption failed',this.self);
    return;
  }
  log.debug('inner',inner.json,inner.body)

  // process the handshake info to find a link
  var token = crypto.createHash('sha256').update(packet.body.slice(0,16)).digest().slice(0,16);
  var link = handshake_collect(mesh, token.toString('hex'), inner, pipe, packet);

  if(!link || !link.x)
    return; // can't respond w/o an exchange

  var atOld = link.x.at();
  var sync = link.x.sync(packet, inner);
  var atNew = link.x.at();
  log.debug('handshake sync',sync,atOld,atNew);

  // always send handshake back if not in sync
  if(!sync) link.x.sending(link.handshake(),pipe);

  // new outgoing sync
  if(atNew > atOld)
  {
    log.debug('new outgoing sync');
    link.syncedAt = Date.now();
  }

  // when in sync or we sent a newer at, trust pipe
  if(atNew >= atOld) link.addPipe(pipe, true);

  // if the senders token changed, we need to reset
  if(link.x.session && link.sid != link.x.session.token.toString('hex'))
  {
    link.sid = link.x.session.token.toString('hex');
    log.debug('new session',link.sid);
    link.x.flush(); // any existing channels can resend
    link.setStatus(); // we're up
  }

}
