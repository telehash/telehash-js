var crypto = require('crypto');
var e3x = require('e3x');
var hashname = require('hashname');
var base32 = hashname.base32;
var lob = require('lob-enc');
var stringify = require('json-stable-stringify');

var Pipe = exports.Pipe = require('./pipe').Pipe;

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

// add some default extensions
exports.add(require('../ext/peer'));

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
  
  // a json representation of the current mesh
  mesh.json_store = {};
  
  // return normalized json string of all link info normalized
  mesh.json = function(opts)
  {
    var ret = [];
    Object.keys(mesh.json_store).forEach(function(hn){
      ret.push(mesh.json_store[hn]);
    });
    return stringify(ret, opts);
  }

  // internal util to manage .json_store
  mesh.jsonize = function(args)
  {
    // take just hashname argument
    if(hashname.isHashname(args))
    {
      args = {hashname:args};
    }

    // load from keys
    if(args.keys && (args.csid = hashname.match(args.keys,mesh.keys)))
    {
      args.hashname = hashname.fromKeys(args.keys);
      args.key = args.keys[args.csid];
    }

    // make sure we have a valid hashname
    if(!hashname.isHashname(args.hashname)) return false;
    
    // add/get json store
    var json = mesh.json_store[args.hashname];
    if(!json) json = mesh.json_store[args.hashname] = {hashname:args.hashname,paths:[]};

    // json happy csid/key
    if(args.csid && mesh.keys[args.csid])
    {
      json.csid = args.csid;
      json.key = Buffer.isBuffer(args.key) ? base32.encode(args.key) : args.key;
    }
    
    return json;
  }
  
  // load our own json id
  mesh.jsonize({keys:mesh.keys});

  // on-demand extender
  mesh.extensions = []; // so we only run one once
  mesh.extended = []; // which ones are active
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
        mesh.extended.push(extended);
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

    log.debug(mesh.hashname.substr(0,8),'incoming packet',packet.length,pipe.type);
    
    // all channel packets
    if(packet.head.length == 0)
    {
      var token = packet.body.slice(0,16).toString('hex');
      var link = mesh.links[token];
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

      // our one built-in channel
      if(inner.json.type == 'link') return link.inLink(inner);

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

      // process the untrusted hashname info to find a link
      var link = mesh.from(inner, pipe, packet);
      if(!link || !link.x)
      {
        log.debug('failed to create exchange from handshake',inner);
        return;
      }

      var at = link.x.sync(packet, inner);
      log.debug('handshake sync',at);
      
      // always send handshake back if not in sync
      if(at !== 0) link.x.sending(link.x.handshake(at),pipe);

      // pipes are only valid when they are in sync or we are acking theirs
      if(at === 0 || at === inner.json.at)
      {
        // if it's a new sync, track the timestamp for latency
        if(link.at != at)
        {
          link.syncedAt = Date.now();
          link.at = at;
        }
        link.addPipe(pipe, true);
        link.x.flush(); // any existing channels can resend
        link.link(); // establish link channel
      }
    }
  }
  
  // a safe way to handle incoming hashname information (de-mangler)
  mesh.from = function(inner, pipe, handshake)
  {
    // validate the csid
    if(handshake) inner.json[handshake.head.toString('hex')] = true; // make sure matches the handshake
    var csid = hashname.match(mesh.keys,inner.json);
    if(!csid)
    {
      log.debug('invalid hashname, unsupported csid',inner.json);
      return false;
    }
    if(inner.json[csid] !== true)
    {
      log.debug('invalid hashname, mismatch csid',csid,inner.json);
      return false;
      
    }

    // build a from json container
    var from = {paths:[]};
    from.hashname = hashname.fromPacket(inner);
    if(!from.hashname)
    {
      log.debug('invalid hashname info',inner);
      return false;
    }
    from.csid = csid;
    from.key = inner.body;
    if(pipe.path) from.paths.push(pipe.path);

    // make sure we have a link
    if(!mesh.links[from.hashname])
    {
      log.debug('untrusted hashname',from);
      if(handshake) from.received = {packet:handshake, pipe:pipe} // optimization for link
      if(mesh.discoverable) mesh.discoverable.discover(from);
      return false;
    }
    
    // call link again to do any initialization w/ the new info
    from.sync == false; // tell .link to not auto-sync!
    return mesh.link(from);
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
    Object.keys(mesh.json_store).forEach(function(hn){
      if(hn == link.hashname) return;
      mesh.links[hn].addPath({type:'peer',hn:link.hashname});
    });
  }
  
  // enabled discovery mode
  mesh.discover = function(opts, cbDiscover)
  {
    if(!cbDiscover) cbDiscover = function(err){if(err) log.error(err)};
    if(opts === true) opts = {};
    if(!opts.discover) opts.discover = mesh.link; // defaults to always link
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
  mesh.links = {}; // track by hashname and exchange token
  mesh.link = function(args, cbLink)
  {
    var json = mesh.jsonize(args);

    // minimally required
    if(!json)
    {
      mesh.err = 'invalid args: '+JSON.stringify(args);
      return false;
    }

    // do we already have a link
    var link = mesh.links[json.hashname];

    // this is the big block where we create a new link
    if(!link)
    {
      link = mesh.links[json.hashname] = {hashname:json.hashname, json:json, isLink:true};
      
      // link-packet validation handler, defaults to allow all
      link.onLink = function(pkt,cb){
        cb();
      }

      // generic handler for any active channel
      link.receiving = function(err, packet, cbChan){
        if(err) return link.setStatus(err);
        link.onLink(packet, function(err, packet){
          link.setStatus(err);
          if(packet) link.channel.send(packet);
          cbChan(err);
        });
      }

      // try to create/sync a link channel
      link.link = function()
      {
        // make sure we can
        if(!link.x || !link.x.session) return log.debug('no link exchange session');

        // if existing channel and mismatch, deref it
        if(link.channel && link.x.channels[link.channel.id] != link.channel) link.channel = false;

        // always fetch a new packet to send
        link.onLink(undefined, function(err,packet){
          if(err) return log.debug('onLink err',hn,err);
          if(!packet) packet = {json:{}};

          // may need to create a new outoing channel
          if(!link.channel)
          {
            packet.json.type = 'link';
            link.channel = link.x.channel(packet);
            link.channel.receiving = link.receiving;
          }

          log.debug('sending link',hn,packet.json);
          if(!link.channel.send(packet)) log.debug('channel send failed',link.x.err);
        });
      }
      
      // handle new incoming link channel requests
      link.inLink = function(open)
      {
        // create channel and process open
        log.debug('new incoming link',open.json);
        var channel = link.x.channel(open);
        channel.receiving = link.receiving;
        channel.receive(open);
        // if newer link channel, use it as the default
        if(link.channel && link.channel.id < channel.id) link.channel = channel;
      }

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
            var seenA = link.seen[a.uid];
            var seenB = link.seen[b.uid];
            // if both seen since last sync, prefer earliest
            if(seenA > link.syncedAt && seenB > link.syncedAt) return seenA - seenB;
            // if either is in sync, prefer them
            if(seenA > link.snycedAt) return -1;
            if(seenB > link.snycedAt) return 1;
            // if both old, prefer newest
            return seenB - seenA;
          });
        }

        // added pipe that hasn't been seen since a sync, send most recent handshake again
        if(!see && seen && seen < link.syncedAt) link.x.sending(link.x.handshake(),pipe);
      }
      
      // make sure the path is in the json
      link.jsonPath = function(path)
      {
        // add to json if not exact duplicate
        if(link.json.paths.filter(function(pold){
          return (stringify(pold) == stringify(path));
        }).length == 0) link.json.paths.push(path);
      }

      // make sure a path is added to the json and pipe created
      link.addPath = function(path, cbPath)
      {
        log.debug('addPath',path);
        link.jsonPath(path);
        mesh.extended.forEach(function(ext){
          if(typeof ext.pipe != 'function') return;
          log.debug('ext.pipe',ext.name);
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
        var handshake = link.x.handshake(true); // forces new
        // track these for per-pipe latency on responses
        link.at = 0;
        link.syncedAt = Date.now();
        link.pipes.forEach(function(pipe){
          link.x.sending(handshake, pipe);
        });
        
        return true;
      }
      
      // new link is created, also run extensions per link
      mesh.extended.forEach(function(ext){
        if(typeof ext.link != 'function') return;
        log.debug('extending link with',ext.name);
        ext.link(link, function(err){
          if(err) log.warn('extending a link returned an error',ext.name,err);
        });
      });

    }
    
    // create exchange if possible
    if(!link.x && link.json.csid && (link.x = mesh.self.exchange({csid:link.json.csid, key:base32.decode(link.json.key)})))
    {
      log.debug('adding exchange',link.hashname,link.x.id);
    
      // add the exchange token id for routing back to this active link
      mesh.links[link.x.id] = link;

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
    if(link.json.csid && !link.x) log.warn('failed to create exchange',link.json,self.err);
    
    // we have a link now, proccess any more args

    // custom link channel validation/packets
    if(typeof cbLink == 'function') link.onLink = cbLink;

    // if the link was created from a received packet, first continue it
    if(args.received) mesh.receive(args.received.packet, args.received.pipe);

    // set any paths given
    if(Array.isArray(args.paths)) args.paths.forEach(link.addPath);

    // supplement w/ paths to default routers
    mesh.routers.forEach(function(router){
      link.addPath({type:'peer',hn:router});
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

  // last, iterate load any/all extensions, callback when fully done
  var extboot = mesh.args.extensions || exports.extensions;
  var todo = Object.keys(extboot);
  if(!todo.length) cbMesh(undefined, mesh);
  var done = 0;
  var error;
  // run them all in parallel so that synchronous ones aren't blocked
  todo.forEach(function(name){
    mesh.extend(extboot[name], function(err){
      error = error || err;
      if(++done == todo.length) cbMesh(error, mesh);
    });
  });
  
  return mesh;
}

