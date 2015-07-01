var crypto = require('crypto');
var e3x = require('e3x');
var hashname = require('hashname');
var base32 = hashname.base32;
var lob = require('lob-enc');
var stringify = require('json-stable-stringify');
var TLink = require('./link.class');

module.exports = Mesh;

var log = {};

function Mesh (args, cbMesh, telehash){
  if(typeof cbMesh != 'function') cbMesh = function(err, mesh){ if(err) log.error(err); return mesh; }; // stub for sync usage
  if(typeof args != 'object' || typeof args.id != 'object') return cbMesh('invalid args, requires id');


  log = telehash._log
  this.hashname = hashname.fromKeys(args.id.keys);

  // convert all id keys/secrets to pairs for e3x
  var opts = {pairs:{}};
  Object.keys(args.id.keys).forEach(function(csid){
    var pair = opts.pairs[csid] = {};
    // flexible buffer or base32 input
    pair.key = Buffer.isBuffer(args.id.keys[csid]) ? args.id.keys[csid]
             : base32.decode(args.id.keys[csid]);

    pair.secret = Buffer.isBuffer(args.id.secrets[csid]) ? args.id.secrets[csid]
                : base32.decode(args.id.secrets[csid]);
  });
  opts.debug = log.debug;

  this.self = e3x.self(opts);
  if(!this.self)
    return cbMesh(e3x.err);

  this.lib = telehash;
  this.log = telehash._log;
  this.args = args;
  this.keys = args.id.keys;
  args.id = null;
  this.linkedhash = null;
  this.extended = [];
  this.extensions = [];
  this.index = {}; // track by hashname and exchange token
  this.links = []; // easy array of all

  this.routes = {}; // routed token => pipe mapping
  this.routers = []; // default routers

  // track any current public addresses per-mesh
  this.public = {
    ipv4 : args.ipv4 || null,
    ipv6 : args.ipv6 || null,
    url  : args.url  || null
  };

  this.json_store ={}

  // load our own json id
  this.jsonize(this.hashname, {keys:this.keys});


  // after extensions have run, load any other arguments
  function ready(err, mesh)
  {
    // links can be passed in
    if(Array.isArray(args.links))
      args.links.forEach(function(link){
        if(link.hashname == mesh.hashname)
          return; // ignore ourselves, happens
        mesh.link(link);
      });
    cbMesh(err, mesh);
  }

  // next, iterate load any/all extensions, callback when fully done
  var extboot = this.args.extensions || telehash.extensions;
  var todo = Object.keys(extboot);
  if(!todo.length)
    ready(null, mesh);

  // run them all in parallel so that synchronous ones aren't blocked
  var done = 0;
  var error;
  var mesh = this;
  for (var i in todo)
    this.extend(extboot[todo[i]], function(err){
      error = error || err;
      if(++done == todo.length) ready(error, mesh);
    });



  return this;
}

Mesh.prototype.log = function(l){
  log = l;
  return this;
}

Mesh.prototype.jsonize = function Mesh_jsonize(hn, args){
    // add/get json store
  var json = this.json_store[hn];
  if(!json)
    json = this.json_store[hn] = {hashname:hn,paths:[],keys:{}};

  if(args.keys)
    json.keys = args.keys;

  // only know a single csid/key
  if(args.csid && args.key)
  {
    json.keys[args.csid] = args.key;
  }

  // make sure no buffers
  Object.keys(json.keys).forEach(function(csid){
    if(Buffer.isBuffer(json.keys[csid]))
      json.keys[csid] = base32.encode(json.keys[csid]);
  });

  return json;
}


// return our own shareable json id
Mesh.prototype.json = function Mesh_json()
{
  var json = this.json_store[this.hashname];
  json.paths = this.paths(); // dynamic
  return json;
}

// return our own shareable URI
Mesh.prototype.uri = function(uri)
{
  uri = uri || "link://";
  uri = urilib.decode(uri);
  uri.hostname = uri.hostname || this.public.ipv4;

  // go through all paths to get best

  var json = this.json();
  if (!(uri.hostname && uri.port)){
    var paths = json.paths;

  }

  for (var i in paths ){
    if (uri.hostname && uri.port)
      break;
    uri.hostname = uri.hostname || paths[i].ip;
    uri.port = uri.port || paths[i].port;
  }

  uri.hostname = uri.hostname || '127.0.0.1';

  return urilib.keys(uri, json.keys);
}

// return normalized json string of all link info normalized, or callback for change events
Mesh.prototype.linked = function(cb)
{
  // if given a callback, use that on any change
  if(typeof cb == 'function')
  {
    this.linked_cb = cb;
    this.linked_hash = ''; // dirty the cache
  }

  var all = [];
  this.links.forEach(function(link){
    all.push(link.json);
  });
  all.push(this.json());
  var ret = stringify(all, {space:2});

  var hash = crypto.createHash('sha256').update(ret).digest('hex');
  if(hash !== this.linked_hash)
  {
    this.linked_hash = hash;
    this.linked_cb(all, ret);
  }

  return ret;
}


// on-demand extender

// active local instances of an extension for this mesh
Mesh.prototype.extending = function(extended)
{
  if(this.extended.indexOf(extended) >= 0)
    return;
  this.extended.push(extended);
  // any current links
  this.links.forEach(function(link){
    link.extend(extended);
  });
}

// so we only run an extension once
Mesh.prototype.extend = function(ext, cbExtend){

  // callback is optional
  cbExtend = cbExtend || function cbExtend(err){log.debug('extend stub err',err);};
  // only do once per mesh
  if(this.extensions.indexOf(ext) >= 0) return cbExtend();
  log.debug('extending mesh with',ext.name);
  this.extensions.push(ext);
  if(typeof ext.mesh != 'function') return cbExtend();
  // give it a chance to fill in and set up
  var mesh = this;
  ext.mesh(mesh, function(err, extended){
    if(extended)
    {
      extended.name = ext.name; // enforce
      mesh.extending(extended);
    }
    cbExtend(err, extended);
  });
};

// when routing, we need to keep a 1-min cache to dedup any circular routes
// TODO: per route ttl
var dedup = {};
setInterval(function dedupt(){dedup={}},60*1000);


Mesh.prototype._receive_channel = function Mesh_receive_channel(packet, pipe){
  var token = packet.body.slice(0,16).toString('hex');
  var link = this.index[token];
  if(!link)
  {
    var route = this.routes[token];
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

Mesh.prototype._receive_handshake = function Mesh_receive_handshake(packet, pipe){
  var inner = this.self.decrypt(packet);
  if(!inner)
  {
    log.debug('message decryption failed',this.self.err);
    return;
  }
  log.debug('inner',inner.json,inner.body)

  // process the handshake info to find a link
  var token = crypto.createHash('sha256').update(packet.body.slice(0,16)).digest().slice(0,16);
  var link = this.handshake(token.toString('hex'), inner, pipe, packet);
  if(!link || !link.x) return; // can't respond w/o an exchange

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

function receive_packet_type(packet, pipe){

  if(!packet || !pipe)
    return new Error('invalid mesh.receive args',typeof packet,typeof pipe);

  if(!lob.isPacket(packet) && !(packet = lob.decloak(packet)))
    return new Error('invalid packet',typeof packet);

  if(packet.cloaked)
    pipe.cloaked = true;


  return (packet.head.length === 0) ? "channel" : "handshake";

}
// handle incoming packets from any transports
Mesh.prototype.receive = function(packet, pipe)
{
  log.debug(this.hashname.substr(0,8),'incoming packet',packet.length,pipe.type);

  var type = receive_packet_type(packet, pipe)
  // all channel packets
  if(type === "channel")
    return this._receive_channel(packet, pipe);
  else if (type === "handshake") // if not channel, it's a handshake
    return this._receive_handshake(packet, pipe);
  else if (type instanceof Error)
    return log.debug(type)
}

// cache incoming handshakes to aggregate them
var hcache = {};
setInterval(function hcachet(){hcache={}},60*1000);

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
}

function handshake_validate(handshake, message){
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

  return true;

}

function handshake_types (handshake){
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

// collect incoming handshakes to accept them
Mesh.prototype.handshake = function Mesh_handshake(id, handshake, pipe, message)
{
  handshake = handshake_bootstrap(handshake);

  if (!handshake)
    return false;

  var valid = handshake_validate(handshake);

  if (!valid)
    return false;


  // add it to the cache

  hcache[id] = (hcache[id] || [] ).concat([handshake]);

  // get all from cache w/ matching at, by type
  var types = handshake_types(handshake);

  // bail unless we have a link
  if(!types.link)
  {
    log.debug('handshakes w/ no link yet',id,hset);
    return false;
  }

  // build a from json container
  var from = handshake_from(handshake, pipe, types.link)

  // if we already linked this hashname, just update w/ the new info
  if(this.index[from.hashname])
  {
    from.sync = false; // tell .link to not auto-sync!
    return this.link(from);
  }

  log.debug('untrusted hashname',from);
  from.received = {packet:hset.link._message, pipe:pipe} // optimization hints as link args
  from.handshake = types; // include all handshakes
  if(mesh.accept)
    mesh.accept(from);
  return false;
}

// sanitize any discovered data before accepting
Mesh.prototype.discovered = function(to)
{
  if(!to || typeof to != 'object' || typeof to.keys != 'object')
    return;

  to.hashname = hashname.fromKeys(to.keys);
  if(!to.hashname)
    return log.warn('invalid hashname',to.keys);
  if(to.hashname == this.hashname)
    return; // can't discover ourselves

  this.log.debug('processing discovery',to.hashname);
  to.csid = hashname.match(this.keys,to.keys);
  if(!to.csid)
    return mesh.log.warn('invalid json discovered',to);
  if(this.index[to.hashname]) return; // already known

  //finally do this if everythings OK
  if(this.accept)
    this.accept(to);
}


// add a default router
Mesh.prototype.router = function(link, isRouter)
{
  // just change our router status
  if(typeof link == 'boolean')
  {
    this.json().router = link;
    this.linked(); // we changed the json!
    return;
  }

  // add link as a router
  if(typeof link != 'object' || !link.isLink)
    return log.warn('invald args to mesh.router, not a link',link);

  if(typeof isRouter != 'boolean') isRouter = true; // default to true

  var index = this.routers.indexOf(link);

  // no longer a default
  if(!isRouter)
  {
    delete link.json.router;
    if(index >= 0) this.routers.splice(index,1);
    return;
  }

  // add default router to all
  link.json.router = true;
  if(index == -1) this.routers.push(link);
  this.links.forEach(function(link2){
    if(link2 == link) return;
    link2.addPath({type:'peer',hn:link.hashname});
  });
}

// enabled discovery mode
Mesh.prototype.discover = function(opts, cbDiscover)
{
  if(!cbDiscover) cbDiscover = function(err){if(err) log.error(err)};
  if(opts === true)
    opts = {};
  log.debug('discovery is',opts?'on':'off');
  this.discoverable = opts;
  // notify all extensions
  var extensions = this.extended.slice(0);
  while (extensions.length > 0){
    var ext = extensions.shift();
    if (typeof ext.discover === "function")
      ext.discover(opts, function(){})
  }

  cbDiscover()

}

// collect all the current known paths
Mesh.prototype.paths = function()
{
  var ret = [];
  this.extended.forEach(function(ext){
    if(typeof ext.paths != 'function') return;
    ext.paths().forEach(function(path){
      ret.push(JSON.parse(JSON.stringify(path)));
    });
  });
  return ret;
}

// create/get link
Mesh.prototype.link = function(rawargs, cbLink)
{
  var args = TLink.ParseArguments(rawargs);

  if (args instanceof Error || args.hashname === this.hashname)
    return TLink.Bail(args, this, cbLink);

  // get/create link
  var link = this.index[args.hashname]
          || new TLink(this, args, log);


  // set/update info
  link.setInfo(args);

  link.createExchange();

  // pipes, paths, packets...
  link.initialize(args)

  // add callback as a one-time event listener
  if (typeof cbLink === 'function')
    link.once('status', cbLink)

  return link;
}
// utility to bind two meshes together, establishing links and internal pipes
Mesh.prototype.mesh = function(meshB)
{
  var meshA = this;

  // create virtual pipes
  var pipeAB = new Pipe('mesh');
  var pipeBA = new Pipe('mesh');

  // direct pipes to the other side
  function AB_onSend(packet){meshB.receive(packet,pipeBA)};
  function BA_onSend(packet){meshA.receive(packet,pipeAB)};

  pipeAB.on('send',function(context,a){
    AB_onSend(a[0])
  });

  pipeBA.on('send',function(context,a){
    BA_onSend(a[0])
  });
  // create links both ways
  var linkAB = meshA.link({keys:meshB.keys});
  var linkBA = meshB.link({keys:meshA.keys});

  // add the internal pipes
  linkAB.addPipe(pipeAB);
  linkBA.addPipe(pipeBA);
}
