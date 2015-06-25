var crypto = require('crypto');
var e3x = require('e3x');
var hashname = require('hashname');
var base32 = hashname.base32;
var lob = require('lob-enc');
var stringify = require('json-stable-stringify');
var Pipe = require('./pipe').Pipe;
var urilib = require('./uri');
var TLink = require('./link.class')

// export some of these to the whole package for apps to use directly as telehash.*
exports.e3x = e3x;
exports.hashname = hashname;
exports.base32 = base32;
exports.lob = lob;
exports.Pipe = Pipe;
exports.uri = urilib;

// activity/debugging logging utilities
var log = {
  error:function(){console.error.apply(console,arguments);},
  warn:function(){console.warn.apply(console,arguments);},
  debug:function(){},
  info:function(){console.log.apply(console,arguments);}
}
// override/set any logging level
exports.log = function(args)
{
  if(typeof args == 'object') Object.keys(args).forEach(function(type){
    log[type] = args[type];
  });
  TLink.Log(log);
  return log;
}

// keep track of all default extensions
exports.extensions = [];
exports.add = function(ext)
{
  log.debug('adding extension',ext&&ext.name);
  if(!ext || typeof ext.name != 'string') return false;
  exports.extensions[ext.name] = ext;
  return true;
}

// add the default extensions
exports.add(require('../ext/peer'));
exports.add(require('../ext/path'));
exports.add(require('../ext/stream'));
exports.add(require('../ext/thtp'));
exports.add(require('../ext/chat'));

// generate new local id
exports.generate = function(cb)
{
  log.debug('generating secrets');
  e3x.generate(function(err,pairs){
    if(err)
    {
      log.debug('e3x gen failed',err);
      return cb(err);
    }
    var id = {keys:{},secrets:{}};
    Object.keys(pairs).forEach(function(csid){
      id.keys[csid] = base32.encode(pairs[csid].key);
      id.secrets[csid] = base32.encode(pairs[csid].secret);
    });
    id.hashname = hashname.fromKeys(id.keys);
    log.info('generated new id',id.hashname);
    cb(undefined,id);
  });
}

exports.mesh = function(args, cbMesh)
{
  if(typeof cbMesh != 'function') cbMesh = function(err, mesh){ if(err) log.error(err); return mesh; }; // stub for sync usage
  if(typeof args != 'object' || typeof args.id != 'object') return cbMesh('invalid args, requires id');
  var hn = hashname.fromKeys(args.id.keys);
  if(!hn) return cbMesh('invalid keys');

  // convert all id keys/secrets to pairs for e3x
  var opts = {pairs:{}};
  Object.keys(args.id.keys).forEach(function(csid){
    var pair = opts.pairs[csid] = {};
    // flexible buffer or base32 input
    pair.key = Buffer.isBuffer(args.id.keys[csid]) ? args.id.keys[csid] : base32.decode(args.id.keys[csid]);
    pair.secret = Buffer.isBuffer(args.id.secrets[csid]) ? args.id.secrets[csid] : base32.decode(args.id.secrets[csid]);
  });
  opts.debug = log.debug;
  var self = e3x.self(opts);
  if(!self) return cbMesh(e3x.err);
  log.debug('created new mesh',hn);

  // bundle stuff inside for extensions to use
  var mesh = {self:self, lib:exports, log:log};

  // keep args handy but dereference id/secret
  mesh.args = args;
  mesh.keys = args.id.keys;
  delete args.id;
  mesh.hashname = hn;

  // track any current public addresses per-mesh
  mesh.public = {};
  if(args.ipv4) mesh.public.ipv4 = args.ipv4;
  if(args.ipv6) mesh.public.ipv6 = args.ipv6;
  if(args.url) mesh.public.url = args.url;

  // a json representation of the current mesh
  mesh.json_store = {};

  // internal util to manage .json_store
  mesh.jsonize = function(hn, args)
  {
    // add/get json store
    var json = mesh.json_store[hn];
    if(!json) json = mesh.json_store[hn] = {hashname:hn,paths:[],keys:{}};

    if(args.keys) json.keys = args.keys;

    // only know a single csid/key
    if(args.csid && args.key)
    {
      json.keys[args.csid] = args.key;
    }

    // make sure no buffers
    Object.keys(json.keys).forEach(function(csid){
      if(Buffer.isBuffer(json.keys[csid])) json.keys[csid] = base32.encode(json.keys[csid]);
    });

    return json;
  }

  // load our own json id
  mesh.jsonize(mesh.hashname, {keys:mesh.keys});

  // return our own shareable json id
  mesh.json = function()
  {
    var json = mesh.json_store[mesh.hashname];
    json.paths = mesh.paths(); // dynamic
    return json;
  }

  // return our own shareable URI
  mesh.uri = function(uri)
  {
    if(!uri) uri = 'link://';
    uri = urilib.decode(uri);

    // go through all paths to get best
    if(!uri.hostname) uri.hostname = mesh.public.ipv4;
    var json = mesh.json();
    json.paths.forEach(function(path){
      if(!uri.hostname && path.ip) uri.hostname = path.ip;
      if(!uri.port && path.port) uri.port = path.port;
    });
    if(!uri.hostname) uri.hostname = '127.0.0.1';

    return urilib.keys(uri, json.keys);
  }

  // return normalized json string of all link info normalized, or callback for change events
  mesh.linked_hash;
  mesh.linked_cb = function(){};
  mesh.linked = function(cb)
  {
    // if given a callback, use that on any change
    if(typeof cb == 'function')
    {
      mesh.linked_cb = cb;
      mesh.linked_hash = ''; // dirty the cache
    }

    var all = [];
    mesh.links.forEach(function(link){
      all.push(link.json);
    });
    all.push(mesh.json());
    var ret = stringify(all, {space:2});

    var hash = crypto.createHash('sha256').update(ret).digest('hex');
    if(hash !== mesh.linked_hash)
    {
      mesh.linked_hash = hash;
      mesh.linked_cb(all, ret);
    }

    return ret;
  }


  // on-demand extender

  // active local instances of an extension for this mesh
  mesh.extended = [];
  mesh.extending = function(extended)
  {
    if(mesh.extended.indexOf(extended) >= 0) return;
    mesh.extended.push(extended);
    // any current links
    mesh.links.forEach(function(link){
      link.extend(extended);
    });
  }

  // so we only run an extension once
  mesh.extensions = [];
  mesh.extend = function(ext, cbExtend){
    // callback is optional
    if(!cbExtend) cbExtend = function(err){log.debug('extend stub err',err);};
    // only do once per mesh
    if(mesh.extensions.indexOf(ext) >= 0) return cbExtend();
    log.debug('extending mesh with',ext.name);
    mesh.extensions.push(ext);
    if(typeof ext.mesh != 'function') return cbExtend();
    // give it a chance to fill in and set up
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
  var dedup = {};
  setInterval(function dedupt(){dedup={}},60*1000);

  // handle incoming packets from any transports
  mesh.receive = function(packet, pipe)
  {
    if(!packet || !pipe) return log.debug('invalid mesh.receive args',typeof packet,typeof pipe);

    if(!lob.isPacket(packet) && !(packet = lob.decloak(packet))) return log.debug('invalid packet',typeof packet);
    if(packet.cloaked) pipe.cloaked = true;
    log.debug(mesh.hashname.substr(0,8),'incoming packet',packet.length,pipe.type);

    // all channel packets
    if(packet.head.length == 0)
    {
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
    }

    // all message (handshake) packets
    if(packet.head.length == 1)
    {
      var inner = mesh.self.decrypt(packet);
      if(!inner)
      {
        log.debug('message decryption failed',mesh.self.err);
        return;
      }
      log.debug('inner',inner.json,inner.body)

      // process the handshake info to find a link
      var token = crypto.createHash('sha256').update(packet.body.slice(0,16)).digest().slice(0,16);
      var link = mesh.handshake(token.toString('hex'), inner, pipe, packet);
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
  }

  // cache incoming handshakes to aggregate them
  var hcache = {};
  setInterval(function hcachet(){hcache={}},60*1000);

  // collect incoming handshakes to accept them
  mesh.handshake = function(id, handshake, pipe, message)
  {
    // default an at for bare key handshakes if not given
    if(typeof handshake.json.at === 'undefined') handshake.json.at = Date.now();

    // verify at
    if(typeof handshake.json.at != 'number' || handshake.json.at <= 0)
    {
      log.debug('invalid handshake at',handshake.json);
      return false;
    }

    // default the handshake type
    if(typeof handshake.json.type != 'string') handshake.json.type = 'link';

    // upvert deprecated key to link type
    if(handshake.json.type == 'key')
    {
      // map only csid keys into attachment header
      var json = {};
      hashname.ids(handshake.json).forEach(function(csid){
        if(handshake.json[csid] === true) handshake.json.csid = csid; // cruft
        json[csid] = handshake.json[csid];
      });
      if(message) json[message.head.toString('hex')] = true;
      var attach = lob.encode(json, handshake.body);
      handshake.json.type = 'link';
      handshake.body = attach;
    }

    // do extra validation on link handshakes right away
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
    if(!hcache[id]) hcache[id] = [];
    hcache[id].push(handshake);

    // get all from cache w/ matching at, by type
    var hset = {};
    hcache[id].forEach(function(hs){
      if(hs.json.at !== handshake.json.at) return;
      hset[hs.json.type] = hs;
    });

    // bail unless we have a link
    if(!hset.link)
    {
      log.debug('handshakes w/ no link yet',id,hset);
      return false;
    }

    // build a from json container
    var from = {paths:[]};
    from.hashname = hset.link.json.hashname;
    from.csid = hset.link.json.csid;
    from.key = hset.link.body;
    if(pipe.path) from.paths.push(pipe.path);

    // if we already linked this hashname, just update w/ the new info
    if(mesh.index[from.hashname])
    {
      from.sync == false; // tell .link to not auto-sync!
      return mesh.link(from);
    }

    log.debug('untrusted hashname',from);
    from.received = {packet:hset.link._message, pipe:pipe} // optimization hints as link args
    from.handshake = hset; // include all handshakes
    if(mesh.accept) mesh.accept(from);
    return false;
  }

  // sanitize any discovered data before accepting
  mesh.discovered = function(to)
  {
    if(!to || typeof to != 'object' || typeof to.keys != 'object') return;
    to.hashname = hashname.fromKeys(to.keys);
    if(!to.hashname) return log.warn('invalid hashname',to.keys);
    if(to.hashname == mesh.hashname) return; // can't discover ourselves
    mesh.log.debug('processing discovery',to.hashname);
    to.csid = hashname.match(mesh.keys,to.keys);
    if(!to.csid) return mesh.log.warn('invalid json discovered',to);
    if(mesh.index[to.hashname]) return; // already known
    if(mesh.accept) mesh.accept(to);
  }

  mesh.routes = {}; // routed token => pipe mapping
  mesh.routers = []; // default routers

  // add a default router
  mesh.router = function(link, isRouter)
  {
    // just change our router status
    if(typeof link == 'boolean')
    {
      mesh.json().router = link;
      mesh.linked(); // we changed the json!
      return;
    }

    // add link as a router
    if(typeof link != 'object' || !link.isLink) return log.warn('invald args to mesh.router, not a link',link);
    if(typeof isRouter != 'boolean') isRouter = true; // default to true
    var index = mesh.routers.indexOf(link);

    // no longer a default
    if(!isRouter)
    {
      delete link.json.router;
      if(index >= 0) mesh.routers.splice(index,1);
      return;
    }

    // add default router to all
    link.json.router = true;
    if(index == -1) mesh.routers.push(link);
    mesh.links.forEach(function(link2){
      if(link2 == link) return;
      link2.addPath({type:'peer',hn:link.hashname});
    });
  }

  // enabled discovery mode
  mesh.discover = function(opts, cbDiscover)
  {
    if(!cbDiscover) cbDiscover = function(err){if(err) log.error(err)};
    if(opts === true) opts = {};
    log.debug('discovery is',opts?'on':'off');
    mesh.discoverable = opts;
    // notify all extensions
    var extensions = mesh.extended.slice(0);
    function iter(err)
    {
      if(err) return cbDiscover(err);
      var ext = extensions.shift();
      if(!ext) return cbDiscover();
      if(typeof ext.discover != 'function') return iter();
      ext.discover(opts,iter);
    }
    iter();
  }

  // collect all the current known paths
  mesh.paths = function()
  {
    var ret = [];
    mesh.extended.forEach(function(ext){
      if(typeof ext.paths != 'function') return;
      ext.paths().forEach(function(path){
        ret.push(JSON.parse(JSON.stringify(path)));
      });
    });
    return ret;
  }

  // create/get link
  mesh.index = {}; // track by hashname and exchange token
  mesh.links = []; // easy array of all
  mesh.link = function(rawargs, cbLink)
  {
<<<<<<< HEAD
    var args = TLink.ParseArguments(rawargs)

    if (args instanceof Error || args.hashname === mesh.hashname)
      return TLink.Bail(args, mesh, cbLink);
=======
    var args = rawargs;
    if(hashname.isHashname(args)) args = {hashname:args};
    if(typeof args == 'string') args = urilib.decode(args); // take a uri
    if(typeof cbLink != 'function') cbLink = function(err){ if(err) log.warn(err); };
    if(typeof args != 'object')
    {
      mesh.err = 'invalid args: '+JSON.stringify(rawargs);
      cbLink(mesh.err);
      return false;
    }

    // set hashname if just given keys
    if(args.keys) args.hashname = hashname.fromKeys(args.keys);

    if(!hashname.isHashname(args.hashname))
    {
      mesh.err = 'invalid hashname: '+JSON.stringify(args);
      cbLink(mesh.err);
      return false;
    }

    if(args.hashname == mesh.hashname)
    {
      log.debug('ignoring link request to ourselves',(new Error()).stack);
      cbLink('cannot link self');
      return false;
    }

    // get/create link
    var link = mesh.index[args.hashname]
            || new TLink(mesh, args, log);


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
  mesh.mesh = function(meshB)
  {
    var meshA = mesh;

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

  // after extensions have run, load any other arguments
  function ready(err)
  {
    // links can be passed in
    if(Array.isArray(args.links)) args.links.forEach(function(link){
      if(link.hashname == mesh.hashname) return; // ignore ourselves, happens
      mesh.link(link);
    });
    cbMesh(err, mesh);
  }

  // next, iterate load any/all extensions, callback when fully done
  var extboot = mesh.args.extensions || exports.extensions;
  var todo = Object.keys(extboot);
  if(!todo.length) ready();

  // run them all in parallel so that synchronous ones aren't blocked
  var done = 0;
  var error;
  todo.forEach(function(name){
    mesh.extend(extboot[name], function(err){
      error = error || err;
      if(++done == todo.length) ready(error);
    });
  });

  return mesh;
}
