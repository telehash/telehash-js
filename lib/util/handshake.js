var crypto = require('crypto');
var lob = require('lob-enc');
var hashname = require('hashname');

module.exports = {
  bootstrap : handshake_bootstrap,
  validate  : handshake_validate,
  from      : handshake_from,
  types     : handshake_types,
  receive   : handshake_receive,
  Log       : importlog
};
var log = {}
function importlog(l){
  log = l;
}


// cache incoming handshakes to aggregate them
var hcache = {};
setInterval(function hcachet(){hcache={}},60*1000);

function handshake_receive(mesh, packet, pipe){
  var inner = mesh.self.decrypt(packet);
  if(!inner)
  {
    log.debug('message decryption failed',this.self);
    return;
  }
  log.debug('inner',inner.json,inner.body)

  // process the handshake info to find a link
  var token = crypto.createHash('sha256').update(packet.body.slice(0,16)).digest().slice(0,16);
  var link = mesh.handshake(token.toString('hex'), inner, pipe, packet);

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

function handshake_bootstrap(handshake){
  // default an at for bare key handshakes if not given
  if(typeof handshake.json.at === 'undefined')
    handshake.json.at = Date.now();

  // verify at
  if(typeof handshake.json.at != 'number' || handshake.json.at <= 0)
  {
    log.debug('invalid handshake at',handshake.json);
    return false;
  }

  // default the handshake type
  if(typeof handshake.json.type != 'string')
    handshake.json.type = 'link';

  // upvert deprecated key to link type
  if(handshake.json.type == 'key')
  {
    // map only csid keys into attachment header
    var json = {};
    hashname.ids(handshake.json).forEach(function(csid){
      if(handshake.json[csid] === true)
        handshake.json.csid = csid; // cruft
      json[csid] = handshake.json[csid];
    });

    if(message)
      json[message.head.toString('hex')] = true;

    var attach = lob.encode(json, handshake.body);
    handshake.json.type = 'link';
    handshake.body = attach;
  }

  return handshake
}

function handshake_validate(id,handshake, message, mesh){
  if(handshake.json.type == 'link')
  {
    // if it came from an encrypted message
    if(message)
    {
      // make sure the link csid matches the message csid
      handshake.json.csid = message.head.toString('hex');
      // stash inside the handshake, can be used later to create the exchange immediately
      handshake._message = message;
    }

    var attach = lob.decode(handshake.body);
    if(!attach)
    {
      log.debug('invalid link handshake attachment',handshake.body);
      return false;
    }

    // make sure key info is at least correct
    var keys = {};
    keys[handshake.json.csid] = attach.body;
    var csid = hashname.match(mesh.keys, keys, null, attach.json);
    if(handshake.json.csid != csid)
    {
      log.debug('invalid key handshake, unsupported csid',attach.json, keys);
      return false;
    }
    handshake.json.hashname = hashname.fromKeys(keys, attach.json);
    if(!handshake.json.hashname)
    {
      log.debug('invalid key handshake, no hashname',attach.json, keys);
      return false;
    }

    // hashname is valid now, so stash key bytes in handshake
    handshake.body = attach.body;
  }

  // add it to the cache

  hcache[id] = (hcache[id] || [] ).concat([handshake]);

  return true;

}

function handshake_types (handshake, id){
  var types = {}
  hcache[id].forEach(function(hs){
    if(hs.json.at === handshake.json.at)
      types[hs.json.type] = hs;
  });
  return types;
}

function handshake_from (handshake, pipe, link){
  return {
    paths    : (pipe.path) ? [pipe.path] : [],
    hashname : link.json.hashname,
    csid     : link.json.csid,
    key      : link.body
  };
}
