var crypto = require('crypto');
var e3x = require('e3x');
var hashname = require('hashname');
var base32 = hashname.base32;
var lob = require('lob-enc');
var stringify = require('json-stable-stringify');
var TLink = require('./link.class');
var Pipe = require('./pipe.class');
var urilib = require('./util/uri');
var handshakelib = require("./util/handshake");
var receive = require('./util/receive');
var loadMeshJSON = require('./util/json').loadMeshJSON;
var dedup = require('./util/cache').Route;
module.exports = Mesh;

var log = require("./util/log")("Mesh");

//TODO: this might belong in E3X
function normalizeArgs(id){
  var keys = id.keys;
  var pairs = {};

  Object.keys(id.keys).forEach(function forEachCSID(csid){
    var pair = pairs[csid] = {};
    // flexible buffer or base32 input
    pair.key = Buffer.isBuffer(id.keys[csid]) ? id.keys[csid]
             : base32.decode(id.keys[csid]);

    pair.secret = Buffer.isBuffer(id.secrets[csid]) ? id.secrets[csid]
                : base32.decode(id.secrets[csid]);
  });
  return {pairs: pairs};
}

function createE3X(args){
  var opts = normalizeArgs(args.id);

  return e3x.self(opts);
}


/**
 * @typedef Mesh
 * @class Mesh - Telehash Mesh Node
 * @constructor
 * @param {meshArgs} args - a hash of options for mesh initialization
 * @param {function} callback
 */
function Mesh (args, cbMesh){
  cbMesh = cbMesh || cbDefault; // stub for sync usage

  if(typeof args != 'object' || typeof args.id != 'object')
    return cbMesh('invalid args, requires id');

  this.lib = args.lib;
  this.hashname = hashname.fromKeys(args.id.keys);
  this.log = log;
  this.args = args;
  this.keys = args.id.keys;
  this.linkedhash = null;
  this.extended = [];
  this.extensions = [];
  this.index = {}; // track by hashname and exchange token
  this.links = []; // easy array of all
  this.dedup = new dedup();
  this.routes = {}; // routed token => pipe mapping
  this.routers = []; // default routers
  // track any current public addresses per-mesh
  this.json_store = {};
  this.linked_cb  = function Mesh_linked_cb_noop(){};
  this.public = {
    ipv4 : args.ipv4 || null,
    ipv6 : args.ipv6 || null,
    url  : args.url  || null
  };



  // convert all id keys/secrets to pairs for e3x
  this.self = createE3X(args);
  if(!this.self)
    return cbMesh(e3x.err);
  args.id = null;

  // load our own json id
  loadMeshJSON(this, this.hashname,{keys:this.keys});

  // after extensions have run, load any other arguments
  function ready(err, mesh)
  {
    // links can be passed in
    if(Array.isArray(args.links))
      args.links.forEach(function forEachLinkArg(linkArg){
        if(linkArg.hashname == mesh.hashname)
          return; // ignore ourselves, happens
        mesh.link(linkArg);
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
  todo.forEach(function (ext){
    mesh.extend(extboot[ext], function forEachExtension(err){
      error = error || err;
      if(++done == todo.length) ready(error, mesh);
    });
  });




  return this;
}

Mesh.log = function Mesh_log(args){
  return log;
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
Mesh.prototype.uri = function Mesh_uri(uri)
{
  uri = uri || "link://";
  uri = urilib.decode(uri);
  uri.hostname = uri.hostname || this.public.ipv4;

  // go through all paths to get best

  var json = this.json();
  if (!(uri.hostname && uri.port)){
    var paths = json.paths;

    for (var i in paths ){
      if (uri.hostname && uri.port)
        break;
      uri.hostname = uri.hostname || paths[i].ip;
      uri.port = uri.port || paths[i].port;
    }
  }
  uri.hostname = uri.hostname || '127.0.0.1';

  return urilib.keys(uri, json.keys);
};

/**
 * @param {function=} callback - for change events
 * @return {string} json string of all link info normalized.
 */
Mesh.prototype.linked = function Mesh_linked(cb)
//TODO: convert Mesh to inherit from eventEmitter
{
  // if given a callback, use that on any change
  if(typeof cb == 'function')
  {
    this.linked_cb = cb;
    this.linked_hash = ''; // dirty the cache
  }

  var all = [];
  this.links.forEach(function ForEachLink(link){
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
};


/** on-demand extender for the mesh
 * @param {extension} extended - a telehash extension (implimentors notes coming soon)
 */
Mesh.prototype.extending = function Mesh_extending(extended)
{
  if(this.extended.indexOf(extended) >= 0)
    return;
  this.extended.push(extended);
  // any current links
  this.links.forEach(function ForEachLink(link){
    link.extend(extended);
  });
};

// so we only run an extension once
Mesh.prototype.extend = function Mesh_extend(ext, cbExtend){

  // callback is optional
  cbExtend = cbExtend || cbDefault;
  // only do once per mesh
  if(this.extensions.indexOf(ext) >= 0)
    return cbExtend();

  log.debug('extending mesh with',ext.name);

  this.extensions.push(ext);
  if(typeof ext.mesh === 'function') {
    // give it a chance to fill in and set up
    var mesh = this;
    ext.mesh(mesh, function meshExtensionInstallCB(err, extended){
      if(extended)
      {
        extended.name = ext.name; // enforce
        mesh.extending(extended);
      }
      cbExtend(err, extended);
    });
  } else {
    return cbExtend();
  }

};

/**
 *  Main routing to handle incoming packets from any transport
 * @param {Buffer} packet the raw packet buffer
 * @param {pipe} pipe a telehash transport pipe
 */
Mesh.prototype.receive = function Mesh_receive(packet, pipe)
{

  packet = receive.decloak(packet, pipe);
  if (packet instanceof Error)
    return log.debug(packet);


  log.debug(this.hashname.substr(0,8),'incoming packet',packet.length,pipe.type);

  var type = receive.type(packet, pipe);

  if(type === "channel")
    return receive.channel(this, packet, pipe);
  else if (type === "handshake")
    return receive.handshake(this, packet, pipe);
  else if (type instanceof Error)
    return log.debug(type);
};


/**
 * collect incoming handshakes to accept them
 * @param {object} id
 * @param {handshake} handshake
 * @param {pipe} pipe
 * @param {Buffer} message
 */
Mesh.prototype.handshake = function Mesh_handshake(id, handshake, pipe, message)
{
  var val = false;
  //decode and validate
  handshake = handshakelib.bootstrap(handshake);

  if (handshake && handshakelib.validate(id, handshake, message, this)){
    // get all from cache w/ matching at, by type
    var types = handshakelib.types(handshake, id);

    if (types.link){
      var from = handshakelib.from(handshake, pipe, types.link);

      if(this.index[from.hashname]){
        from.sync = false; // tell .link to not auto-sync!
        val = this.link(from);
      } else {
        log.debug('untrusted hashname',from);
        from.received = {packet:types.link._message, pipe:pipe}; // optimization hints as link args
        from.handshake = types; // include all handshakes
        if(this.accept)
          this.accept(from);
      }
    } else {
      // bail if no link
      log.debug('handshakes w/ no link yet', id, types)
    }
  }

  return val;
};

// sanitize any discovered data before accepting
Mesh.prototype.discovered = function Mesh_discovered(to)
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
};


/** declare wether a link should be used as a router to aid in link creation.
 * By default, all meshs will perform routing functions.
 * if the link argument is ommited, this function sets the behaivior of the local node
 * @param {TLink=} [link=The local Mesh] - the remote link to use as a router
 * @param {Boolean=} [isRouter=true] - whether to declare the target as a router;
 */
Mesh.prototype.router = function Mesh_router(link, isRouter)
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
    if(index >= 0)
      this.routers.splice(index,1);
  } else {
    // add default router to all
    link.json.router = true;
    if(index == -1)
      this.routers.push(link);

    this.links.forEach(function ForEachLink(link2){
      if(link2 != link)
        link2.addPath({type:'peer',hn:link.hashname});
    });
  }
};

function cbDefault(err, ret){
  return (err) ? log.error(err) : ret;
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
Mesh.prototype.discover = function Mesh_discover(opts, cbDiscover)
{
  cbDiscover = cbDiscover || cbDefault;
  if(opts === true)
    opts = {};
  log.debug('discovery is',opts?'on':'off');
  this.discoverable = opts;
  // notify all extensions
  var extensions = this.extended.slice(0);
  while (extensions.length > 0){
    var ext = extensions.shift();
    if (typeof ext.discover === "function")
      ext.discover(opts, function noop(){});
  }

  cbDiscover();
  return;
};

/** collect current addressible paths for this mesh, if any
 * @return {Array} paths - an array of @pathJSON objects
 */
Mesh.prototype.paths = function Mesh_paths()
{
  var ret = [];
  this.extended.forEach(function ForEachExtension(ext){
    if(typeof ext.paths != 'function') return;
    ext.paths().forEach(function ForEachPath(path){
      ret.push(JSON.parse(JSON.stringify(path)));
    });
  });
  return ret;
};

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

  if (args instanceof Error || (args.hashname === this.hashname))
    return TLink.Bail(args, this, cbLink);

  // get/create link
  var link = this.index[args.hashname]
          || new TLink(this, args, log);


  // set/update info
  link.setInfo(args);

  link.createExchange();

  // pipes, paths, packets...
  link.initialize(args);

  // add callback as a one-time event listener
  if (typeof cbLink === 'function')
    link.once('status', cbLink);

  return link;
};

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
  function AB_onSend(packet){target.receive(packet,pipeBA);}
  function BA_onSend(packet){meshA.receive(packet,pipeAB);}

  pipeAB.on('send',function(context,a){
    AB_onSend(a);
  });

  pipeBA.on('send',function(context,a){
    BA_onSend(a);
  });
  // create links both ways
  var linkAB = meshA.link({keys:target.keys});
  var linkBA = target.link({keys:meshA.keys});

  // add the internal pipes
  linkAB.addPipe(pipeAB);
  linkBA.addPipe(pipeBA);
};
