var crypto = require('crypto');
var e3x = require('e3x');
var hashname = require('hashname');
var base32 = hashname.base32;
var lob = require('lob-enc');
var stringify = require('json-stable-stringify');

var Pipe = exports.Pipe = require('./pipe').Pipe;
var URIze = require('./uri');

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
  mesh.uri = function(protocol, token)
  {
    var json = mesh.json();
    var uri = {address:mesh.public.ipv4,keys:json.keys};
    uri.protocol = protocol;
    uri.token = token;
    // go through all paths to get best
    json.paths.forEach(function(path){
      if(!uri.address && path.ip) uri.address = path.ip;
      if(!uri.port && path.port) uri.port = path.port;
    });
    return URIze.encode(uri);
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
      if(link.x.channels[inner.json.c]) return link.x.channels[inner.json.c].receive(inner);

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
      if(!sync) link.x.sending(link.x.handshake(),pipe);
      
      // new outgoing sync
      if(atNew > atOld)
      {
        log.debug('new outgoing sync');
        link.syncedAt = Date.now();
      }

      // when in sync or we sent a newer at, trust pipe
      if(atNew >= atOld) link.addPipe(pipe, true);

      // if the senders token changed, we need to reset
      if(link.sid != link.x.session.token.toString('hex'))
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
    if(typeof handshake.json.type != 'number') handshake.json.type = 'key';
    
    // do extra validation on key handshakes right away
    if(handshake.json.type == 'key')
    {
      // if it came from an encrypted message
      if(message)
      {
        handshake.json[message.head.toString('hex')] = true; // make sure the key matches the message csid
        handshake._message = message; // stash inside the handshake, can be used later to create the exchange immediately
      }

      // make sure key info is at least usable
      handshake.json.csid = hashname.match(mesh.keys,handshake.json);
      if(!handshake.json.csid)
      {
        log.debug('invalid key handshake, unsupported csid',handshake.json);
        return false;
      }
      if(handshake.json[handshake.json.csid] !== true)
      {
        log.debug('invalid key handshake, mismatch csid',handshake.json);
        return false;
      }
      handshake.json.hashname = hashname.fromPacket(handshake);
      if(!handshake.json.hashname)
      {
        log.debug('invalid key handshake, no hashname',handshake.json);
        return false;
      }
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
    
    // bail unless we have a key
    if(!hset.key)
    {
      log.debug('handshakes w/ no key yet',id,hset);
      return false;
    }
    
    // build a from json container
    var from = {paths:[]};
    from.hashname = hset.key.json.hashname;
    from.csid = hset.key.json.csid;
    from.key = hset.key.body;
    if(pipe.path) from.paths.push(pipe.path);

    // if we already linked this hashname, just update w/ the new info
    if(mesh.index[from.hashname])
    {
      from.sync == false; // tell .link to not auto-sync!
      return mesh.link(from);
    }

    log.debug('untrusted hashname',from);
    from.received = {packet:hset.key._message, pipe:pipe} // optimization hints as link args
    from.handshake = hset; // include all handshakes
    if(mesh.accept) mesh.accept(from);
    return false;
  }

  mesh.routes = {}; // routed token => pipe mapping
  mesh.routers = []; // default routers

  // add a default router
  mesh.router = function(link, isRouter)
  {
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
    var args = rawargs;
    if(hashname.isHashname(args)) args = {hashname:args};
    if(typeof args == 'string') args = URIze.decode(args); // take a uri
    if(typeof args != 'object')
    {
      mesh.err = 'invalid args: '+JSON.stringify(rawargs);
      log.error(mesh.err);
      return false;
    }
    
    // set hashname if just given keys
    if(args.keys) args.hashname = hashname.fromKeys(args.keys);

    if(!hashname.isHashname(args.hashname))
    {
      mesh.err = 'invalid hashname: '+JSON.stringify(args);
      log.error(mesh.err);
      return false;
    }
    
    if(args.hashname == mesh.hashname)
    {
      log.debug('ignoring link request to ourselves');
      return false;
    }

    // do we already have a link
    var link = mesh.index[args.hashname];

    // this is the big block where we create a new link
    if(!link)
    {
      link = mesh.index[args.hashname] = {hashname:args.hashname, isLink:true};
      mesh.links.push(link);

      // manage link status notification (link.down is any error)
      link.onStatus = [];
      link.down = 'init';
      link.setStatus = function(err){
        if(link.down === err) return;
        link.down = err;
        link.up = !link.down; // convenience
        log.debug('link is',link.down||'up');
        link.onStatus.forEach(function(cbStatus){
          cbStatus(link.down, link);
        });
      }
      
      // app can add/set link status change callback 
      link.status = function(cbStatus){
        if(typeof cbStatus != 'function') return link.down;
        if(link.onStatus.indexOf(cbStatus) == -1) link.onStatus.push(cbStatus);
        // if we already have a status, call immediately
        if(link.down != 'init') process.nextTick(function(){
          cbStatus(link.down, link);
        });
      }
      
      // use this info as a router to reach this link
      link.router = function(router)
      {
        if(!router || !router.isLink)
        {
          log.warn('invalid link.router args, not a link',direct);
          return false;
        }
        link.addPath({type:'peer',hn:router.hashname});
        return true;
      }
      
      // used by pipe tracking
      link.pipes = [];
      link.seen = {};
      link.syncedAt = Date.now();

      // existing pipes, add/update for this link
      link.addPipe = function(pipe, see)
      {
        // add if it doesn't exist
        if(link.pipes.indexOf(pipe) < 0)
        {
          log.debug(link.hashname,'adding new pipe',pipe.path);

          // all keepalives trigger link sync
          pipe.on('keepalive', link.sync);

          // add any path to json
          if(pipe.path) link.jsonPath(pipe.path);
          
          // add to all known for this link
          link.pipes.push(pipe);
          
          // send most recent handshake if it's not seen
          if(!see) pipe.send(link.x && link.x.handshake(), link, function(){});
        }

        var seen = link.seen[pipe.uid];
        
        // whenever a pipe is seen after a sync, update it's timestamp and resort
        if(see && (!seen || seen < link.syncedAt))
        {
          seen = Date.now();
          log.debug('pipe seen latency', pipe.uid, pipe.path, seen - link.syncedAt);
          link.seen[pipe.uid] = seen;

          // always keep them in sorted order, by shortest latency or newest
          link.pipes = link.pipes.sort(function(a,b){
            var seenA = link.seen[a.uid]||0;
            var seenB = link.seen[b.uid]||0;
            // if both seen since last sync, prefer earliest
            if(seenA >= link.syncedAt && seenB >= link.syncedAt) return seenA - seenB;
            // if either is in sync, prefer them
            if(seenA >= link.snycedAt) return -1;
            if(seenB >= link.snycedAt) return 1;
            // if both old, prefer newest
            return seenB - seenA;
          });
          log.debug('resorted, default pipe',link.pipes[0].path);
        }

        // added pipe that hasn't been seen since a sync, send most recent handshake again
        if(!see && seen && seen < link.syncedAt) link.x.sending(link.x.handshake(),pipe);
      }
      
      // make sure the path is in the json
      link.jsonPath = function(path)
      {
        // add to json if not exact duplicate
        var str = stringify(path);
        if(link.json.paths.filter(function(pold){
          return (stringify(pold) == str);
        }).length == 0)
        {
          log.debug('addPath',path);
          link.json.paths.push(path);
        }
      }

      // make sure a path is added to the json and pipe created
      link.addPath = function(path, cbPath)
      {
        if(path.type == 'peer' && path.hn == link.hashname) return log.debug('skipping peer path to self');
        link.jsonPath(path);
        mesh.extended.forEach(function(ext){
          if(typeof ext.pipe != 'function') return;
          ext.pipe(link, path, function(pipe){
            link.addPipe(pipe);
            if(typeof cbPath == 'function') cbPath(pipe);
          });
        });
      }

      // sync all pipes, try to create/init exchange if we have key info
      link.sync = function()
      {
        // any keepalive event, sync all pipes w/ a new handshake
        log.debug('link sync keepalive',link.hashname);
        link.x.at(link.x.at()+1); // forces new
        var handshake = link.x.handshake();
        // track sync time for per-pipe latency on responses
        link.syncedAt = Date.now();
        link.pipes.forEach(function(pipe){
          link.seen[pipe.uid] = 0; // reset all seen now too
          link.x.sending(handshake, pipe);
        });
        
        return true;
      }
      
      // notify an extension of a link
      link.extend = function(ext)
      {
        if(typeof ext.link != 'function') return;
        log.debug('extending link with',ext.name);
        ext.link(link, function(err){
          if(err) log.warn('extending a link returned an error',ext.name,err);
        });
      }

      // new link is created, also run extensions per link
      mesh.extended.forEach(link.extend);

    }
    
    // update/set json info
    link.json = mesh.jsonize(link.hashname, args);
    link.csid = hashname.match(mesh.keys, link.json.keys);
    
    // create exchange if possible
    if(!link.x && link.csid && (link.x = mesh.self.exchange({csid:link.csid, key:base32.decode(link.json.keys[link.csid])})))
    {
      log.debug('adding exchange',link.hashname,link.x.id);
    
      // add the exchange token id for routing back to this active link
      mesh.index[link.x.id] = link;

      link.x.sending = function(packet, pipe)
      {
        if(!packet) return log.debug('sending no packet',packet);
        if(!pipe)
        {
          if(link.pipes.length == 0) return log.debug('no pipes for',link.hashname);
          pipe = link.pipes[0];
        }
        log.debug(mesh.hashname.substr(0,8),'delivering',packet.length,'to',link.hashname.substr(0,8),pipe.path);
        pipe.send(packet, link, function(err){
          if(err) log.warn('error sending packet to pipe',link.hashname,pipe.path,err);
        });
      }
    }
    // helpful
    if(link.csid && !link.x) log.warn('failed to create exchange',link.json,self.err);
    
    // we have a link now, proccess any more args

    // custom link channel validation/packets
    if(typeof cbLink == 'function') link.onLink = cbLink;

    // if the link was created from a received packet, first continue it
    if(args.received) mesh.receive(args.received.packet, args.received.pipe);

    // set any paths given
    if(Array.isArray(args.paths)) args.paths.forEach(link.addPath);

    // supplement w/ paths to default routers
    mesh.routers.forEach(function(router){
      if(link.hashname == router.hashname) return;
      link.addPath({type:'peer',hn:router.hashname});
    });

    // default router state can be passed in on args as a convenience
    if(typeof args.router == 'boolean') mesh.router(link, args.router);

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
    pipeAB.onSend = function(packet){meshB.receive(packet,pipeBA)};
    pipeBA.onSend = function(packet){meshA.receive(packet,pipeAB)};

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
    if(Array.isArray(args.links)) args.links.forEach(mesh.link);
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

