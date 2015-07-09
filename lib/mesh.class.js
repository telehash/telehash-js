var crypto = require('crypto');
var e3x = require('e3x');
var hashname = require('hashname');
var base32 = hashname.base32;
var lob = require('lob-enc');
var stringify = require('json-stable-stringify');
var TLink = require('./link.class');
var Pipe = require('./pipe.class');
var urilib = require('./util/uri');
var handshakelib = require("./util/handshake")
var loadMeshJSON = require('./util/json').loadMeshJSON;
var dedup = require('./util/cache').Route;
module.exports = Mesh;

var log = {};


/**
 * @typedef Mesh
 * @class Mesh - Telehash Mesh Node
 * @constructor
 * @param {meshArgs} args - a hash of options for mesh initialization
 * @param {function} callback
 */
function Mesh (args, cbMesh, telehash){
  if(typeof cbMesh != 'function')
    cbMesh = function cbMesh_noop(err, mesh){
      if(err)
        log.error(err);
      return mesh;
    }; // stub for sync usage
  if(typeof args != 'object' || typeof args.id != 'object')
    return cbMesh('invalid args, requires id');


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
  this.dedup = new dedup()

  this.routes = {}; // routed token => pipe mapping
  this.routers = []; // default routers

  // track any current public addresses per-mesh
  this.public = {
    ipv4 : args.ipv4 || null,
    ipv6 : args.ipv6 || null,
    url  : args.url  || null
  };

  this.json_store = {};
  this.linked_cb  = function Mesh_linked_cb_noop(){};

  // load our own json id
  loadMeshJSON(this, this.hashname,{keys:this.keys});


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
    cbMesh(err,mesh);
  }

  // next, iterate load any/all extensions, callback when fully done
  var extboot = this.args.extensions || telehash.extensions;
  var todo = Object.keys(extboot);
  if(!todo.length)
    ready(null, this);

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





/**
 * @return {object} A shareable json id for this mesh.
 */
Mesh.prototype.json = function Mesh_json()
{
  var json = this.json_store[this.hashname];
  json.paths = this.paths(); // dynamic
  return json;
}

/**
 * @return {string} A shareable link uri for this mesh.
 */
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

/**
 * @param {function=} callback - for change events
 * @return {string} json string of all link info normalized.
 */
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


/** on-demand extender for the mesh
 * @param {extension} extended - a telehash extension (implimentors notes coming soon)
 */
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


Mesh.prototype._receive_channel = function Mesh_receive_channel(packet, pipe){
  var token = packet.body.slice(0,16).toString('hex');
  var link = this.index[token];
  if(!link)
  {
    var route = this.routes[token];
    if(route && this.dedup.insert(packet))
    {
      log.debug('routing packet to',route.path);
      return route.send(packet, undefined, function(){});
    }
    log.debug('dropping unknown/duplicate channel packet to',token);
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
  for(var i=0;i<this.extended.length;i++)
  {
    if(typeof this.extended[i].open != 'object') continue;
    var handler = this.extended[i].open[inner.json.type];
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
    log.debug('message decryption failed',this.self);
    return;
  }
  log.debug('inner',inner.json,inner.body)

  // process the handshake info to find a link
  var token = crypto.createHash('sha256').update(packet.body.slice(0,16)).digest().slice(0,16);
  var link = this.handshake(token.toString('hex'), inner, pipe, packet);

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

function receive_packet_type(packet, pipe){

  if(!packet || !pipe)
    return new Error('invalid mesh.receive args',typeof packet,typeof pipe);


  return (packet.head.length === 0) ? "channel"
       : (packet.head.length === 1) ? "handshake"
       : "unknown";

}

function receive_packet_cloak(packet, pipe){
  if(!lob.isPacket(packet) && !(packet = lob.decloak(packet)))
    return new Error('invalid packet ' + typeof packet);

  if(packet.cloaked)
    pipe.cloaked = true;

  return packet;
}

/**
 *  Main routing to handle incoming packets from any transport
 * @param {Buffer} packet the raw packet buffer
 * @param {pipe} pipe a telehash transport pipe
 */
Mesh.prototype.receive = function(packet, pipe)
{

  packet = receive_packet_cloak(packet, pipe);
  if (packet instanceof Error)
    return log.debug(packet);


  log.debug(this.hashname.substr(0,8),'incoming packet',packet.length,pipe.type);

  var type = receive_packet_type(packet, pipe);

  if(type === "channel")
    return this._receive_channel(packet, pipe);
  else if (type === "handshake")
    return this._receive_handshake(packet, pipe);
  else if (type instanceof Error)
    return log.debug(type)
}


/**
 * collect incoming handshakes to accept them
 * @param {object} id
 * @param {handshake} handshake
 * @param {pipe} pipe
 * @param {Buffer} message
 */
Mesh.prototype.handshake = function Mesh_handshake(id, handshake, pipe, message)
{
  handshake = handshakelib.bootstrap(handshake);
  if (!handshake)
    return false;

  var valid = handshakelib.validate(id,handshake, message, this);
  if (!valid)
    return false;

  // get all from cache w/ matching at, by type
  var types = handshakelib.types(handshake, id);

  // bail unless we have a link
  if(!types.link)
  {
    log.debug('handshakes w/ no link yet',id,types);
    return false;
  }

  // build a from json container
  var from = handshakelib.from(handshake, pipe, types.link)

  // if we already linked this hashname, just update w/ the new info
  if(this.index[from.hashname])
  {
    from.sync = false; // tell .link to not auto-sync!
    return this.link(from);
  }

  log.debug('untrusted hashname',from);
  from.received = {packet:types.link._message, pipe:pipe} // optimization hints as link args
  from.handshake = types; // include all handshakes
  if(this.accept)
    this.accept(from);
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
c}


/** declare wether a link should be used as a router to aid in link creation.
 * By default, all meshs will perform routing functions.
 * if the link argument is ommited, this function sets the behaivior of the local node
 * @param {TLink=} [link=The local Mesh] - the remote link to use as a router
 * @param {Boolean=} [isRouter=true] - whether to declare the target as a router;
 */
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

  isRouter = (isRouter === undefined) ? true : isRouter; // default to true

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

/** Discovery mode enables any network transport to send un-encrypted announcements
 * to any other endpoints that are available locally only. This can be used to
 * automatically establish a link to a local peer when there is no other mechanism
 * to exchange keys, such as when they are offline.
 *
 * IMPORTANT: This should be used sparingly, as anything on a local network will
 * be made aware of the sending hashname.  While this is generally very low risk,
 * it should not be left on by default except in special cases.

 * @param {Boolean} on - true to enable, false to disable
 * @param {function} callback - a callback function with any error
 */
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
  return;
}

/** collect current addressible paths for this mesh, if any
 * @return {Array} paths - an array of @pathJSON objects
 */
Mesh.prototype.paths = function Mesh_paths()
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

/**
 * create or retrieve a link to another mesh (local or remote). Accepts multiple
 * raw arguments to provide the necessary info to connect to the target mesh.
 * @param {linkURI|hashname|object} raw - either a @linkURI, @hashname, or @thirdformatname
 * @param {function=} callback - one time listener for the TLink 'status' event
 * @return {TLink}
 */
Mesh.prototype.link = function(rawargs, cbLink)
{
  var args = TLink.ParseArguments(rawargs);

  console.log(args.hashname, this.hashname)

  if (args instanceof Error || (args.hashname === this.hashname))
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

/** utility to bind two meshes together, establishing links and internal pipes
 * @param {Mesh} target - the mesh to connect to
 */
Mesh.prototype.mesh = function(target)
{
  var meshA = this;

  // create virtual pipes
  var pipeAB = new Pipe('mesh');
  var pipeBA = new Pipe('mesh');

  // direct pipes to the other side
  function AB_onSend(packet){target.receive(packet,pipeBA)};
  function BA_onSend(packet){meshA.receive(packet,pipeAB)};

  pipeAB.on('send',function(context,a){
    AB_onSend(a)
  });

  pipeBA.on('send',function(context,a){
    BA_onSend(a)
  });
  // create links both ways
  var linkAB = meshA.link({keys:target.keys});
  var linkBA = target.link({keys:meshA.keys});

  // add the internal pipes
  linkAB.addPipe(pipeAB);
  linkBA.addPipe(pipeBA);
}
