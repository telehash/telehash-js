var crypto = require("crypto");

var warn = function(){console.log.apply(console,arguments); return undefined; };
var debug = function(){};
//var debug = function(){console.log.apply(console,arguments)};
exports.debug = function(cb){ debug = cb; };
var info = function(){};
//var debug = function(){console.log.apply(console,arguments)};
exports.info = function(cb){ info = cb; };

var defaults = exports.defaults = {};
defaults.chan_timeout = 10000; // how long before for ending durable channels w/ no acks
defaults.chan_autoack = 1000; // is how often we auto ack if the app isn't generating responses in a durable channel
defaults.chan_resend = 2000; // resend the last packet after this long if it wasn't acked in a durable channel
defaults.chan_outbuf = 100; // max size of outgoing buffer before applying backpressure
defaults.chan_inbuf = 50; // how many incoming packets to cache during processing/misses
defaults.nat_timeout = 30*1000; // nat timeout for inactivity
defaults.idle_timeout = 2*defaults.nat_timeout; // overall inactivity timeout
defaults.link_timer = defaults.nat_timeout - (5*1000); // how often the DHT link maintenance runs
defaults.link_max = 256; // maximum number of links to maintain overall (minimum one packet per link timer)
defaults.link_k = 8; // maximum number of links to maintain per bucket

// network preference order for paths
var pathShareOrder = ["bluetooth","webrtc","ipv6","ipv4","http"];

exports.switch = function()
{
  var self = {lines:{}, bridgeLine:{}, all:{}, links:[], capacity:[], rels:{}, raws:{}, paths:[], bridgeCache:{}, networks:{}, CSets:{}};

  self.load = function(id)
  {
    if(typeof id != "object") return "bad keys";
    self.id = id;
    var err = loadkeys(self);
    if(err) return err;
    if(Object.keys(self.cs).length == 0) return "missing cipher sets";
    self.hashname = parts2hn(self.parts);
    return false;
  }
  self.make = keysgen;

  // udp socket stuff
  self.pcounter = 1;
  self.receive = receive;
  // outgoing packets to the network
  self.deliver = function(type, callback){ self.networks[type] = callback};
  self.send = function(path, msg, to){
    if(!msg) return debug("send called w/ no packet, dropping",new Error().stack)&&false;
    if(!path) return debug("send called w/ no path, dropping",new Error().stack)&&false;
    if(!self.networks[path.type]) return false;
    if(to) path = to.pathOut(path);
    debug("<<<<",Date(),msg.length,path&&[path.type,path.ip,path.port,path.id].join(","),to&&to.hashname);
    return self.networks[path.type](path,msg,to);
  };
  self.pathSet = function(path, del)
  {
    var existing;
    if(!path) return;
    if((existing = pathMatch(path,self.paths)))
    {
      if(del) self.paths.splice(self.paths.indexOf(existing),1);
      return;
    }
    debug("local path add",JSON.stringify(path));
    info("self",path.type,JSON.stringify(path));
    self.paths.push(path);
    // trigger pings if we're online
    if(self.isOnline)
    {
      linkMaint(self);
    }
  }

  // map a hashname to an object, whois(hashname)
  self.whois = whois;
  self.whokey = whokey;
  self.start = function(hashname,type,arg,cb)
  {
    var hn = self.whois(hashname);
    if(!hn) return cb("invalid hashname");
    return hn.start(type,arg,cb);
  }

  // connect to the network, online(callback(err))
  self.online = online;

  // handle new reliable channels coming in from anyone
  self.listen = function(type, callback){
    if(typeof type != "string" || typeof callback != "function") return warn("invalid arguments to listen");
    if(type.substr(0,1) !== "_") type = "_"+type;
    self.rels[type] = callback;
  };
  // advanced usage only
  self.raw = function(type, callback){
    if(typeof type != "string" || typeof callback != "function") return warn("invalid arguments to raw");
    self.raws[type] = callback;
  };

  // internal listening unreliable channels
  self.raws["peer"] = inPeer;
  self.raws["connect"] = inConnect;
  self.raws["path"] = inPath;
  self.raws["link"] = inLink;

  // for modules
  self.pencode = pencode;
  self.pdecode = pdecode;
  self.isLocalIP = isLocalIP;
  self.randomHEX = randomHEX;
  self.uriparse = uriparse;
  self.pathMatch = pathMatch;
  self.isHashname = function(hex){return isHEX(hex, 64)};
  self.wraps = channelWraps;
  self.waits = [];
  self.waiting = false
  self.wait = function(bool){
    if(bool) return self.waits.push(true);
    self.waits.pop();
    if(self.waiting && self.waits.length == 0) self.waiting();
  }
  self.ping = function(){
    if(!self.tracer) self.tracer = randomHEX(16);
    var js = {type:"ping",trace:self.tracer};
    Object.keys(self.parts).forEach(function(csid){js[csid] = true;});
    return js;
  }

  linkLoop(self);
  return self;
}



var channelWraps = {};

// do the maintenance work for links
function linkLoop(self)
{
  self.bridgeCache = {}; // reset cache for any bridging
  linkMaint(self); // ping all of them
  setTimeout(function(){linkLoop(self)}, defaults.link_timer);
}

// every link that needs to be maintained, ping them
function linkMaint(self)
{
  // process every bucket
  Object.keys(self.links).forEach(function(hashname){
    hn = self.whois(hashname);
    if(!hn.linked || !pathValid(hn.to)) return;
    if((Date.now() - hn.linked.sentAt) < Math.ceil(defaults.link_timer/2)) return; // we sent to them recently
    hn.linked.send({js:{}});
  });
}

function online(callback)
{
  var self = this;
  if(self.waits.length > 0) return self.waiting = function(){self.online(callback)};
  self.isOnline = true;
  callback(null,0);
}

// self.receive, raw incoming udp data
function receive(msg, path)
{
  var self = this;
  var packet = pdecode(msg);
  if(!packet) return warn("failed to decode a packet from", path, (new Buffer(msg)).toString("hex"));
  if(packet.length == 2) return; // empty packets are NAT pings

  packet.sender = path;
  packet.id = self.pcounter++;
  packet.at = Date.now();
  debug(">>>>",Date(),msg.length, packet.head.length, path&&[path.type,path.ip,path.port,path.id].join(","));

  // either it's an open
  if(packet.head.length == 1)
  {
    var open = deopenize(self, packet);
    if (!open || !open.verify) return warn("couldn't decode open (possibly using the wrong public key?)",open&&open.err);
    if (!isHEX(open.js.line, 32)) return warn("invalid line id enclosed",open.js.line);
    if(open.js.to !== self.hashname) return warn("open for wrong hashname",open.js.to);
    var csid = partsMatch(self.parts,open.js.from);
    if(csid != open.csid) return warn("open with mismatch CSID",csid,open.csid);

    var from = self.whokey(open.js.from,open.key);
    if (!from) return warn("invalid hashname", open.js.from);
    from.csid = open.csid;

    // make sure this open is legit
    if (typeof open.js.at != "number") return warn("invalid at", open.js.at);

    // older open, ignore it
    if(from.openAt && open.js.at < from.openAt) return debug("dropping older open");
    from.openAt = open.js.at;

    debug("inOpen verified", from.hashname,path&&JSON.stringify(path.json));

    // ignore incoming opens if too fast or recent duplicates
    if(open.js.line == from.lineIn)
    {
      var age = Date.now() - (from.openAcked||0);
      if(age < defaults.nat_timeout && from.openDup >= 3) return;
      from.openDup++;
    }else{
      from.openDup = 0;
    }
    
    // always minimally flag activity and send an open ack back via network or relay
    var openAck = from.open(); // inits line crypto
    from.active();
    from.openAcked = Date.now();
    path = from.pathIn(path);
    if(path) self.send(path,openAck,from);
    else if(from.relayChan) from.relayChan.send({body:openAck});

    // only do new line setup once
    if(open.js.line != from.lineIn)
    {
      from.lineIn = open.js.line;
      debug("new line",from.lineIn,from.lineOut);
      self.CSets[open.csid].openline(from, open);
      self.lines[from.lineOut] = from;

      // force reset old channels
      Object.keys(from.chans).forEach(function(id){
        var chan = from.chans[id];
        if(chan)
        {
          // SPECIAL CASE: skip channels that haven't received a packet, they're new waiting outgoing-opening ones!
          if(!chan.recvAt) return;
          // fail all other active channels
          from.receive({js:{c:chan.id,err:"reset"}});
        }
        // actually remove so new ones w/ same id can come in
        delete from.chans[id];
      });
    }

    return;
  }

  // or it's a line
  if(packet.head.length == 0)
  {
    var lineID = packet.body.slice(0,16).toString("hex");
    var from = self.lines[lineID];

    // a matching line is required to decode the packet
    if(!from) {
      if(!self.bridgeLine[lineID]) return debug("unknown line received", lineID, packet.sender);
      debug("BRIDGE",JSON.stringify(self.bridgeLine[lineID]),lineID);
      var id = crypto.createHash("sha256").update(packet.body).digest("hex")
      if(self.bridgeCache[id]) return; // drop duplicates
      self.bridgeCache[id] = true;
      // flat out raw retransmit any bridge packets
      return self.send(self.bridgeLine[lineID],pencode(false,packet.body));
    }

    // decrypt and process
    var err;
    if((err = self.CSets[from.csid].delineize(from, packet))) return debug("couldn't decrypt line",err,packet.sender);
    from.linedAt = from.openAt;
    from.active();
    from.receive(packet);
    return;
  }

  if(Object.keys(packet.js).length > 0) warn("dropping incoming packet of unknown type", packet.js, packet.sender);
}

function whokey(parts, key, keys)
{
  var self = this;
  if(typeof parts != "object") return false;
  var csid = partsMatch(self.parts,parts);
  if(!csid) return false;
  var hn = self.whois(parts2hn(parts));
  if(!hn) return false;
  if(keys) key = keys[csid];
  var err = loadkey(self,hn,csid,key);
  if(err)
  {
    warn("whokey err",hn.hashname,err);
    return false;
  }
  if(crypto.createHash("sha256").update(hn.key).digest("hex") != parts[csid])
  {
    warn("whokey part mismatch",hn.hashname,csid,parts[csid],crypto.createHash("sha256").update(hn.key).digest("hex"));
    delete hn.key;
    return false;
  }
  hn.parts = parts;
  
  return hn;
}

// this creates a hashname identity object (or returns existing), optional from creates a via relationship
function whois(hashname)
{
  var self = this;
  // validations
  if(!hashname) { warn("whois called without a hashname", hashname, new Error().stack); return false; }
  if(typeof hashname != "string") { warn("wrong type, should be string", typeof hashname,hashname); return false; }
  if(!isHEX(hashname, 64)) { warn("whois called without a valid hashname", hashname); return false; }

  // never return ourselves
  if(hashname === self.hashname) { debug("whois called for self"); return false; }

  var hn = self.all[hashname];
  if(hn) return hn;

  // make a new one
  hn = self.all[hashname] = {hashname:hashname, chans:{}, self:self, paths:[], isAlive:0, sendwait:[]};
  hn.at = Date.now();

  // to create a new channels to this hashname
  var sort = [self.hashname,hashname].sort();
  hn.chanOut = (sort[0] == self.hashname) ? 2 : 1;
  hn.start = channel;
  hn.raw = raw;

  hn.pathGet = function(path)
  {
    if(typeof path != "object" || typeof path.type != "string") return false;

    var match = pathMatch(path, hn.paths);
    if(match) return match;

    // clone and also preserve original (hackey)
    path = JSON.parse(JSON.stringify(path));
    if(!path.json) path.json = JSON.parse(JSON.stringify(path));

    debug("adding new path",hn.paths.length,JSON.stringify(path.json));
    info(hn.hashname,path.type,JSON.stringify(path.json));
    hn.paths.push(path);

    // track overall if they have a public IP network
    if(!isLocalPath(path)) hn.isPublic = true;

    // if possibly behind the same NAT (same public ip), set flag to allow/ask to share local paths
    if(path.type == "ipv4") self.paths.forEach(function(path2){
      if(path2.type == "ipv4" && path2.ip == path.ip) hn.isLocal = true;
    })

    return path;
  }

  hn.pathOut = function(path)
  {
    path = hn.pathGet(path);
    if(!path) return false;

    // send a NAT hole punching empty packet the first time
    if(!path.sentAt && path.type == "ipv4") self.send(path,pencode());

    path.sentAt = Date.now();
    if(!pathValid(hn.to) && pathValid(path)) hn.to = path;
    return path;
  }
  
  hn.pathEnd = function(path)
  {
    if(hn.to == path) hn.to = false;
    path.gone = true;
    var index = hn.paths.indexOf(path);
    if(index >= 0) hn.paths.splice(index,1);
    debug("PATH END",JSON.stringify(path.json));
    return false;
  }

  // manage network information consistently, called on all validated incoming packets
  hn.pathIn = function(path)
  {
    path = hn.pathGet(path);
    if(!path) return false;

    // first time we've seen em
    if(!path.recvAt && !path.sentAt)
    {
      debug("PATH INNEW",isLocalPath(path)?"local":"public",JSON.stringify(path.json),hn.paths.map(function(p){return JSON.stringify(p.json)}));

      // update public ipv4 info
      if(path.type == "ipv4" && !isLocalIP(path.ip))
      {
        hn.ip = path.ip;
        hn.port = path.port;
      }
      
      // cull any invalid paths of the same type
      hn.paths.forEach(function(other){
        if(other == path) return;
        if(other.type != path.type) return;
        if(!pathValid(other)) return hn.pathEnd(other);
        // remove any previous path on the same IP
        if(path.ip && other.ip == path.ip) return hn.pathEnd(other);
        // remove any previous http path entirely
        if(path.type == "http") return hn.pathEnd(other);
      });
      
      // any custom non-public paths, we must bridge for
      if(pathShareOrder.indexOf(path.type) == -1) hn.bridging = true;

      // track overall if we trust them as local
      if(isLocalPath(path) && !hn.isLocal)
      {
        hn.isLocal = true;
        hn.pathSync();
      }
    }

    // always update default to newest
    path.recvAt = Date.now();
    hn.to = path;

    return path;
  }
  
  // track whenever a hashname is active
  hn.active = function()
  {
    self.recvAt = Date.now();

    // if we've not been active, (re)sync paths
    if(!hn.recvAt || (Date.now() - hn.recvAt) > defaults.nat_timeout) setTimeout(function(){hn.pathSync()},10);
    hn.recvAt = Date.now();

    // resend any waiting packets (if they're still valid)
    hn.sendwait.forEach(function(packet){
      if(!hn.chans[packet.js.c]) return;
      hn.send(packet);
    });
    hn.sendwait = [];
  }
  
  // try to send a packet to a hashname, doing whatever is possible/necessary
  hn.send = function(packet){
    if(Buffer.isBuffer(packet)) console.log("lined packet?!",hn.hashname,typeof hn.sendwait.length,new Error().stack);
    // if there's a line, try sending it via a valid network path!
    if(hn.lineIn)
    {
      debug("line sending",hn.hashname,hn.lineIn);
      var lined = self.CSets[hn.csid].lineize(hn, packet);
      hn.sentAt = Date.now();

      // directed packets, just dump and done
      if(packet.to) return self.send(packet.to, lined, hn);

      // if there's a valid path to them, just use it
      if(pathValid(hn.to)) return self.send(hn.to, lined, hn);

      // if relay, always send it there
      if(hn.relayChan) return hn.relayChan.send({body:lined});

      // everything else falls through
    }
    
    // we've fallen through, either no line, or no valid paths
    hn.openAt = false;

    // add to queue to send on line
    if(hn.sendwait.indexOf(packet) == -1) hn.sendwait.push(packet);

    debug("alive failthrough");

    // always send to open all known paths to increase restart-resiliency
    if(hn.open()) hn.paths.forEach(function(path){
      self.send(path, hn.open(), hn);
    });

  }

  // handle all incoming line packets
  hn.receive = function(packet)
  {
//    if((Math.floor(Math.random()*10) == 4)) return warn("testing dropping randomly!");
    if(!packet.js || typeof packet.js.c != "number") return warn("dropping invalid channel packet",packet.js);

    // normalize/track sender network path
    packet.sender = hn.pathIn(packet.sender);
    packet.from = hn;

    // find any existing channel
    var chan = hn.chans[packet.js.c];
    debug("LINEIN",chan&&chan.type,JSON.stringify(packet.js),packet.body&&packet.body.length);
    if(chan === false) return; // drop packet for a closed channel
    if(chan) return chan.receive(packet);

    // start a channel if one doesn't exist, check either reliable or unreliable types
    var listening = {};
    if(typeof packet.js.seq == "undefined") listening = self.raws;
    if(packet.js.seq === 0) listening = self.rels;
    // ignore/drop unknowns
    if(!listening[packet.js.type]) return;

    // verify incoming new chan id
    if(packet.js.c % 2 == hn.chanOut % 2) return warn("channel id incorrect",packet.js.c,hn.chanOut)

    // make the correct kind of channel;
    var kind = (listening == self.raws) ? "raw" : "start";
    var chan = hn[kind](packet.js.type, {bare:true,id:packet.js.c}, listening[packet.js.type]);
    chan.receive(packet);
  }
  
  hn.chanEnded = function(id)
  {
    if(!hn.chans[id]) return;
    debug("channel ended",id,hn.chans[id].type,hn.hashname);
    hn.chans[id] = false;
  }

  // track other hashnames this one sees
  hn.sees = function(address)
  {
    if(typeof address != "string") warn("invalid see address",address,hn.hashname);
    if(typeof address != "string") return false;
    var parts = address.split(",");
    if(!self.isHashname(parts[0]) || parts[0] == self.hashname) return false;
    var see = self.whois(parts[0]);
    if(!see) return false;
    // save suggested path if given/valid
    if(parts.length >= 4 && parts[2].split(".").length == 4 && parseInt(parts[3]) > 0) see.pathGet({type:"ipv4",ip:parts[2],port:parseInt(parts[3])});
    if(!see.vias) see.vias = {};
    // save suggested csid if we don't know one yet
    see.vias[hn.hashname] = see.cisd || parts[1];
    return see;
  }

  // return our address to them
  hn.address = function(to)
  {
    if(!to) return "";
    var csid = partsMatch(hn.parts,to.parts);
    if(!csid) return "";
    if(!hn.ip) return [hn.hashname,csid].join(",");
    return [hn.hashname,csid,hn.ip,hn.port].join(",");
  }

  // request a new link to them
  hn.link = function(callback)
  {
    if(!callback) callback = function(){}

    debug("LINKTRY",hn.hashname);
    var js = {};

    if(hn.linked)
    {
      hn.linked.send({js:js});
      return callback();
    }

    hn.linked = hn.raw("link", {retry:3, js:js, timeout:defaults.idle_timeout}, function(err, packet, chan){
      inLink(err, packet, chan);
      callback(packet.js.err);
    });
  }

  // return the current open packet
  hn.open = function()
  {
    if(!hn.parts) return false; // can't open if no key
    if(!hn.opened) hn.opened = openize(self,hn);
    return hn.opened;
  }

  // generate current paths array to them, for peer and paths requests
  hn.pathsOut = function()
  {
    var paths = [];
    self.paths.forEach(function(path){
      if(isLocalPath(path) && !hn.isLocal) return;
      paths.push(path);
    });
    return paths;
  }

  // send a path sync
  hn.pathSync = function()
  {
    if(hn.pathSyncing) return;
    hn.pathSyncing = true;
    debug("pathSync",hn.hashname);
    var js = {};
    var paths = hn.pathsOut();
    if(paths.length > 0) js.paths = paths;
    var alive = [];
    hn.raw("path",{js:js, timeout:10*1000}, function(err, packet){
      if(err)
      {
        hn.pathSyncing = false;
        return;
      }
      
      if(!packet.sender) return; // no sender path is bad

      // add to all answers and update best default from active ones
      alive.push(packet.sender);
      var best = packet.sender;
      alive.forEach(function(path){
        if(pathShareOrder.indexOf(best.type) < pathShareOrder.indexOf(path.type)) return;
        if(isLocalPath(best)) return; // always prefer (the first) local paths
        best = path;
      });
      debug("pathSync best",hn.hashname,JSON.stringify(best.json));
      hn.to = best;
    });
  }
  
  // create a ticket buffer to this hn w/ this packet
  hn.ticket = function(packet)
  {
    if(self.pencode(packet).length > 1024) return false;
    return ticketize(self, hn, packet);
  }

  // decode a ticket buffer from them
  hn.ticketed = function(ticket)
  {
    packet = pdecode(ticket);
    if(!packet) return false;
    return deticketize(self, hn, packet);
  }

  return hn;
}


// create an unreliable channel
function raw(type, arg, callback)
{
  var hn = this;
  var chan = {type:type, callback:callback};
  chan.id = arg.id;
  chan.startAt = Date.now();
  if(!chan.id)
  {
    chan.id = hn.chanOut;
    hn.chanOut += 2;
  }
  chan.isOut = (chan.id % 2 == hn.chanOut % 2);
  hn.chans[chan.id] = chan;

  // raw channels always timeout/expire after the last received packet
  function timer()
  {
    if(chan.timer) clearTimeout(chan.timer);
    chan.timer = setTimeout(function(){
      // signal incoming error if still open, restarts timer
      if(!chan.ended) return hn.receive({js:{err:"timeout",c:chan.id}});
      // clean up references if ended
      hn.chanEnded(chan.id);
    }, arg.timeout);
  }
  chan.timeout = function(timeout)
  {
    arg.timeout = timeout;
    timer();
  }
  chan.timeout(arg.timeout || defaults.chan_timeout);
  
  chan.hashname = hn.hashname; // for convenience

  debug("new unreliable channel",hn.hashname,chan.type,chan.id);

  // process packets at a raw level, very little to do
  chan.receive = function(packet)
  {
    if(!hn.chans[chan.id]) return debug("dropping receive packet to dead channel",chan.id,packet.js)
    chan.opened = true;
    chan.ended = chan.ended || packet.js.err || packet.js.end;
    chan.recvAt = Date.now();
    chan.last = packet.sender;
    chan.callback(chan.ended, packet, chan);
    timer();
  }

  // minimal wrapper to send raw packets
  chan.send = function(packet)
  {
    if(!hn.chans[chan.id]) return debug("dropping send packet to dead channel",chan.id,packet.js);
    if(!packet.js) packet.js = {};
    packet.js.c = chan.id;
    chan.ended = chan.ended || packet.js.err || packet.js.end;
    chan.sentAt = Date.now();
    debug("SEND",chan.type,JSON.stringify(packet.js),packet.body&&packet.body.length);
    hn.send(packet);
  }
  
  // convenience
  chan.end = function()
  {
    if(chan.ended) return;
    chan.send({js:{end:true}});
  }

  chan.fail = function(err)
  {
    if(chan.ended) return;
    chan.ended = err || "failed";
    hn.send({js:{err:chan.ended,c:chan.id}});
  }


  // send optional initial packet with type set
  if(arg.js)
  {
    arg.js.type = type;
    chan.send(arg);
    // retry if asked to, TODO use timeout for better time
    if(arg.retry)
    {
      var at = 1000;
      function retry(){
        if(chan.ended || chan.opened) return; // means we're gone or received a packet
        chan.send(arg);
        if(at < 4000) at *= 2;
        arg.retry--;
        if(arg.retry) setTimeout(retry, at);
      };
      setTimeout(retry, at);
    }
  }

  return chan;
}

// create a reliable channel with a friendlier interface
function channel(type, arg, callback)
{
  var hn = this;
  var chan = {inq:[], outq:[], outSeq:0, inDone:-1, outConfirmed:-1, lastAck:-1, callback:callback};
  chan.id = arg.id;
  chan.startAt = Date.now();
  if(!chan.id)
  {
    chan.id = hn.chanOut;
    hn.chanOut += 2;
  }
  chan.isOut = (chan.id % 2 == hn.chanOut % 2);
  hn.chans[chan.id] = chan;
  // app originating if not bare, be friendly w/ the type, don't double-underscore if they did already
  if(!arg.bare && type.substr(0,1) !== "_") type = "_"+type;
  chan.type = type; // save for debug
  if(chan.type.substr(0,1) != "_") chan.safe = true; // means don't _ escape the json
  chan.hashname = hn.hashname; // for convenience

  debug("new channel",hn.hashname,chan.type,chan.id);
  
  // configure default timeout, for resend
  chan.timeout = function(timeout)
  {
    arg.timeout = timeout;
  }
  chan.timeout(arg.timeout || defaults.chan_timeout);

  // used by app to change how it interfaces with the channel
  chan.wrap = function(wrap)
  {
    if(!channelWraps[wrap]) return false;
    return channelWraps[wrap](chan);
  }

  // called to do eventual cleanup
  function cleanup()
  {
    if(chan.timer) clearTimeout(chan.timer);
    chan.timer = setTimeout(function(){
      chan.ended = chan.ended || true;
      hn.chanEnded(chan.id);
    }, arg.timeout);
  }

  // process packets at a raw level, handle all miss/ack tracking and ordering
  chan.receive = function(packet)
  {
    // if it's an incoming error, bail hard/fast
    if(packet.js.err)
    {
      chan.inq = [];
      chan.ended = packet.js.err;
      chan.callback(packet.js.err, packet, chan, function(){});
      cleanup();
      return;
    }

    chan.recvAt = Date.now();
    chan.opened = true;
    chan.last = packet.sender;

    // process any valid newer incoming ack/miss
    var ack = parseInt(packet.js.ack);
    if(ack > chan.outSeq) return warn("bad ack, dropping entirely",chan.outSeq,ack);
    var miss = Array.isArray(packet.js.miss) ? packet.js.miss : [];
    if(miss.length > 100) {
      warn("too many misses", miss.length, chan.id, packet.from.hashname);
      miss = miss.slice(0,100);
    }
    if(miss.length > 0 || ack > chan.lastAck)
    {
      debug("miss processing",ack,chan.lastAck,miss,chan.outq.length);
      chan.lastAck = ack;
      // rebuild outq, only keeping newer packets, resending any misses
      var outq = chan.outq;
      chan.outq = [];
      outq.forEach(function(pold){
        // packet acknowleged!
        if(pold.js.seq <= ack) {
          if(pold.callback) pold.callback();
          if(pold.js.end) cleanup();
          return;
        }
        chan.outq.push(pold);
        if(miss.indexOf(pold.js.seq) == -1) return;
        // resend misses but not too frequently
        if(Date.now() - pold.resentAt < 1000) return;
        pold.resentAt = Date.now();
        chan.ack(pold);
      });
    }

    // don't process packets w/o a seq, no batteries included
    var seq = packet.js.seq;
    if(!(seq >= 0)) return;

    // auto trigger an ack in case none were sent
    if(!chan.acker) chan.acker = setTimeout(function(){ delete chan.acker; chan.ack();}, defaults.chan_autoack);

    // drop duplicate packets, always force an ack
    if(seq <= chan.inDone || chan.inq[seq-(chan.inDone+1)]) return chan.forceAck = true;

    // drop if too far ahead, must ack
    if(seq-chan.inDone > defaults.chan_inbuf)
    {
      warn("chan too far behind, dropping", seq, chan.inDone, chan.id, packet.from.hashname);
      return chan.forceAck = true;
    }

    // stash this seq and process any in sequence, adjust for yacht-based array indicies
    chan.inq[seq-(chan.inDone+1)] = packet;
    debug("INQ",Object.keys(chan.inq),chan.inDone,chan.handling);
    chan.handler();
  }

  // wrapper to deliver packets in series
  chan.handler = function()
  {
    if(chan.handling) return;
    var packet = chan.inq[0];
    // always force an ack when there's misses yet
    if(!packet && chan.inq.length > 0) chan.forceAck = true;
    if(!packet) return;
    chan.handling = true;
    chan.ended = chan.ended || packet.js.end;
    if(!chan.safe) packet.js = packet.js._ || {}; // unescape all content json
    chan.callback(chan.ended, packet, chan, function(ack){
      // catch whenever it was ended to do cleanup
      chan.inq.shift();
      chan.inDone++;
      chan.handling = false;
      if(ack) chan.ack(); // auto-ack functionality
      // cleanup eventually
      if(chan.ended) cleanup();
      chan.handler();
    });
  }

  // resend the last sent packet if it wasn't acked
  chan.resend = function()
  {
    if(chan.ended) return;
    if(!chan.outq.length) return;
    var lastpacket = chan.outq[chan.outq.length-1];
    // timeout force-end the channel
    if(Date.now() - lastpacket.sentAt > arg.timeout)
    {
      hn.receive({js:{err:"timeout",c:chan.id}});
      return;
    }
    debug("channel resending");
    chan.ack(lastpacket);
    setTimeout(function(){chan.resend()}, defaults.chan_resend); // recurse until chan_timeout
  }

  // add/create ack/miss values and send
  chan.ack = function(packet)
  {
    if(!packet) debug("ACK CHECK",chan.id,chan.outConfirmed,chan.inDone);

    // these are just empty "ack" requests
    if(!packet)
    {
      // drop if no reason to ack so calling .ack() harmless when already ack'd
      if(!chan.forceAck && chan.outConfirmed == chan.inDone) return;
      packet = {js:{}};
    }
    chan.forceAck = false;

    // confirm only what's been processed
    if(chan.inDone >= 0) chan.outConfirmed = packet.js.ack = chan.inDone;

    // calculate misses, if any
    delete packet.js.miss; // when resending packets, make sure no old info slips through
    if(chan.inq.length > 0)
    {
      packet.js.miss = [];
      for(var i = 0; i < chan.inq.length; i++)
      {
        if(!chan.inq[i]) packet.js.miss.push(chan.inDone+i+1);
      }
    }

    // now validate and send the packet
    packet.js.c = chan.id;
    debug("SEND",chan.type,JSON.stringify(packet.js));
    cleanup();
    hn.send(packet);
  }

  // send content reliably
  chan.send = function(arg)
  {
    // create a new packet from the arg
    if(!arg) arg = {};
    // immediate fail errors
    if(arg.err)
    {
      if(chan.ended) return;
      chan.ended = arg.err;
      hn.send({js:{err:arg.err,c:chan.id}});
      return cleanup();
    }
    var packet = {};
    packet.js = chan.safe ? arg.js : {_:arg.js};
    if(arg.type) packet.js.type = arg.type;
    if(arg.end) packet.js.end = arg.end;
    packet.body = arg.body;
    packet.callback = arg.callback;

    // do durable stuff
    packet.js.seq = chan.outSeq++;

    // reset/update tracking stats
    packet.sentAt = Date.now();
    chan.outq.push(packet);

    // add optional ack/miss and send
    chan.ack(packet);

    // to auto-resend if it isn't acked
    if(chan.resender) clearTimeout(chan.resender);
    chan.resender = setTimeout(function(){chan.resend()}, defaults.chan_resend);
    return chan;
  }

  // convenience
  chan.end = function()
  {
    if(chan.ended) return chan.ack();
    chan.send({js:{end:true}});
  }

  // send error immediately, flexible arguments
  chan.fail = function(arg)
  {
    var err = "failed";
    if(typeof arg == "string") err = arg;
    if(typeof arg == "object" && arg.js && arg.js.err) err = arg.js.err;
    chan.send({err:err});
  }

  // send optional initial packet with type set
  if(arg.js)
  {
    arg.type = type;
    chan.send(arg);
  }

  return chan;
}

function inRelay(chan, packet)
{
  var to = chan.relayTo;
  var self = packet.from.self;

  if(packet.js.err || packet.js.end)
  {
    debug("ending relay from",chan.hashname,"to",to.hashname,packet.js.err||packet.js.end);
    if(to.relayChan == chan) to.relayChan = false;
    return;
  }
  
  // clear any older default paths
  if(to.to && to.to.recvAt < chan.startAt) to.to = false;
  
  // most recent is always the current default back
  to.relayChan = chan;
  
  // if the sender has created a bridge, clone their path as the packet's origin!
  var path = (packet.js.bridge) ? JSON.parse(JSON.stringify(packet.sender.json)) : false;
  if(packet.body && packet.body.length) self.receive(packet.body, path);

  // always try a path sync to upgrade the relay
  to.pathSync();
}

// someone's trying to connect to us, send an open to them
function inConnect(err, packet, chan)
{
  // if this channel is acting as a relay
  if(chan.relayTo) return inRelay(chan, packet);

  var to = chan.relayTo = packet.from.self.whokey(packet.js.from,packet.body);
  if(!chan.relayTo) return warn("invalid connect request from",packet.from.hashname,packet.js);

  // up the timeout to the nat default
  chan.timeout(defaults.nat_timeout);

  // try the suggested paths
  if(Array.isArray(packet.js.paths)) packet.js.paths.forEach(function(path){
    if(typeof path.type != "string") return debug("bad path",JSON.stringify(path));
    packet.from.self.send(path,to.open(),to);
  });

  // send back an open through the connect too
  chan.send({body:to.open()});
  
  // we know they see them too
  packet.from.sees(to.hashname);
}

function relay(self, from, to, packet)
{
  if(from.ended && !to.ended) return to.send({js:{err:"disconnected"}});
  if(to.ended && !from.ended) return from.send({js:{err:"disconnected"}});

  var js = {};
  // check to see if we should set the bridge flag for line packets
  var bp = pdecode(packet.body);
  var id = bp && bp.body && bp.body.length > 16 && bp.body.slice(0,16).toString("hex");
  // only create bridge once from valid line packet
  if(id && bp.head.length == 0 && !to.bridged && to.last && !self.lines[id])
  {
    to.bridged = true;
    debug("auto-bridging",to.hashname,id,JSON.stringify(to.last.json))
    self.bridgeLine[id] = JSON.parse(JSON.stringify(to.last.json));
  }

  // have to seen both directions to bridge
  if(from.bridged && to.bridged) js = {"bridge":true};

  // throttle
  if(!from.relayed || Date.now() - from.relayed > 1000)
  {
    from.relayed = Date.now();
    from.relays = 0;
  }
  from.relays++;
  if(from.relays > 5)
  {
    debug("relay too fast, warning",from.relays);
    js.warn = "toofast";
    // TODO start dropping these again in production
//    from.send({js:js});
//    return;
  }

  from.relayed = Date.now();
  to.send({js:js, body:packet.body});
}

// be the middleman to help NAT hole punch
function inPeer(err, packet, chan)
{
  if(err) return;
  var self = packet.from.self;
  if(chan.relay) return relay(self, chan, chan.relay, packet);

  if(!isHEX(packet.js.peer, 64)) return;
  var peer = self.whois(packet.js.peer);
  if(!peer) return;
  
  // only accept peer if active network or support bridging for either party
  if(!(pathValid(peer.to))) return debug("disconnected peer request");

  // start relay via connect, must bundle the senders peer request packet
  chan.timeout(defaults.nat_timeout);
  chan.relay = peer.raw("connect",packet,function(err, packet, chan2){
    if(err) return;
    relay(self, chan2, chan, packet);
  });
}


// accept a dht link
function inLink(err, packet, chan)
{
  if(err) return;
  var self = packet.from.self;
  chan.timeout(defaults.nat_timeout*2); // two NAT windows to be safe

  // add in this link
  debug("LINKUP",packet.from.hashname);
  if(!packet.from.age) packet.from.age = Date.now();
  packet.from.linked = chan;
  self.links[packet.from.hashname] = packet.from;

  // send a response if this is a new incoming
  if(!chan.sentAt) packet.from.link();

  // let mainteanance handle
  chan.callback = inMaintenance;
}

function inMaintenance(err, packet, chan)
{
  // ignore if this isn't the main link
  if(!packet.from || !packet.from.linked || packet.from.linked != chan) return;
  var self = packet.from.self;
  if(err)
  {
    debug("LINKDOWN",packet.from.hashname,err);
    delete packet.from.linked;
    delete self.links[packet.from.hashname];
    // if this channel was ever active, try to re-start it
    if(chan.recvAt) packet.from.link();
    return;
  }

  // only send a response if we've not sent one in a while
  if((Date.now() - chan.sentAt) > Math.ceil(defaults.link_timer/2)) chan.send({js:{}});
}

// update/respond to network state
function inPath(err, packet, chan)
{
  if(err) return;
  var self = packet.from.self;

  // add any/all suggested paths
  if(Array.isArray(packet.js.paths)) packet.js.paths.forEach(function(path){packet.from.pathGet(path)});

  // send back on all paths
  packet.from.paths.forEach(function(path){
    var js = {};
    if(pathShareOrder.indexOf(path.type) >= 0) js.path = path.json;
    chan.send({js:js, to:path});
  });
}


// utility functions

// just return true/false if it's at least the format of a sha1
function isHEX(str, len)
{
  if(typeof str !== "string") return false;
  if(len && str.length !== len) return false;
  if(str.replace(/[a-f0-9]+/i, "").length !== 0) return false;
  return true;
}

// XOR distance between two hex strings, high is furthest bit, 0 is closest bit, -1 is error
function dhash(h1, h2) {
  // convert to nibbles, easier to understand
  var n1 = hex2nib(h1);
  var n2 = hex2nib(h2);
  if(!n1.length || !n2.length) return -1;
  // compare nibbles
  var sbtab = [-1,0,1,1,2,2,2,2,3,3,3,3,3,3,3,3];
  var ret = 252;
  for (var i = 0; i < n1.length; i++) {
    if(!n2[i]) return ret;
    var diff = n1[i] ^ n2[i];
    if (diff) return ret + sbtab[diff];
    ret -= 4;
  }
  return ret;
}

// convert hex string to nibble array
function hex2nib(hex)
{
  var ret = [];
  for (var i = 0; i < hex.length / 2; i ++) {
      var bite = parseInt(hex.substr(i * 2, 2), 16);
      if (isNaN(bite)) return [];
      ret[ret.length] = bite >> 4;
      ret[ret.length] = bite & 0xf;
  }
  return ret;
}

function pathMatch(path1, paths)
{
  var match;
  if(!path1 || !Array.isArray(paths)) return match;
  paths.forEach(function(path2){
    if(!path2 || path2.type != path1.type) return;
    switch(path1.type)
    {
    case "ipv4":
    case "ipv6":
      if(path1.ip == path2.ip && path1.port == path2.port) match = path2;
      break;
    case "http":
      if(path1.http == path2.http) match = path2;
      break;
    default:
      // all other paths match based on id, local, webrtc, etc
      if(path1.id === path2.id) match = path2;
    }
  });
  return match;
}

// validate if a network path is acceptable to stop at
function pathValid(path)
{
  if(!path || path.gone) return false;
  if(!path.recvAt) return false; // all else must receive to be valid
  if(Date.now() - path.recvAt < defaults.nat_timeout) return true; // received anything recently is good
  return false;
}

function partsMatch(parts1, parts2)
{
  if(typeof parts1 != "object" || typeof parts2 != "object") return false;
  var ids = Object.keys(parts1).sort();
  var csid;
  while(csid = ids.pop()) if(parts2[csid]) return csid;
  return false;
}

function isLocalPath(path)
{
  if(!path || !path.type) return false;
  if(path.type == "bluetooth") return true;
  if(path.type == "http" && typeof path.http == "string") return isLocalIP(require("url").parse(path.http).hostname);
  if(["ipv4","ipv6"].indexOf(path.type) >= 0) return isLocalIP(path.ip);
  // http?
  return false;
}

// return if an IP is local or public
function isLocalIP(ip)
{
  // ipv6 ones
  if(ip.indexOf(":") >= 0)
  {
    if(ip.indexOf("::") == 0) return true; // localhost
    if(ip.indexOf("fc00") == 0) return true;
    if(ip.indexOf("fe80") == 0) return true;
    return false;
  }

  var parts = ip.split(".");
  if(parts[0] == "0") return true;
  if(parts[0] == "127") return true; // localhost
  if(parts[0] == "10") return true;
  if(parts[0] == "192" && parts[1] == "168") return true;
  if(parts[0] == "172" && parts[1] >= 16 && parts[1] <= 31) return true;
  if(parts[0] == "169" && parts[1] == "254") return true; // link local
  return false;
}

// return random bytes, in hex
function randomHEX(len)
{
  return crypto.randomBytes(len).toString("hex");
}

function parts2hn(parts)
{
  var rollup = new Buffer(0);
  Object.keys(parts).sort().forEach(function(id){
    rollup = crypto.createHash("sha256").update(Buffer.concat([rollup,new Buffer(id)])).digest();
    rollup = crypto.createHash("sha256").update(Buffer.concat([rollup,new Buffer(parts[id])])).digest();
  });
  return rollup.toString("hex");
}

// encode a packet
function pencode(js, body)
{
  // be flexible, take {js:{},body:...} as first arg
  if(!body && js && js.js)
  {
    body = js.body;
    js = js.js;
  }
  var head = (typeof js == "number") ? new Buffer(String.fromCharCode(js)) : new Buffer(js?JSON.stringify(js):"", "utf8");
  if(typeof body == "string") body = new Buffer(body, "binary");
  body = body || new Buffer(0);
  var len = new Buffer(2);
  len.writeInt16BE(head.length, 0);
  return Buffer.concat([len, head, body]);
}

// packet decoding
function pdecode(packet)
{
  if(!packet) return undefined;
  var buf = (typeof packet == "string") ? new Buffer(packet, "binary") : packet;
  if(packet.length < 2) return undefined;

  // read and validate the json length
  var len = buf.readUInt16BE(0);
  if(len > (buf.length - 2)) return undefined;
  var head = buf.slice(2, len+2);
  var body = buf.slice(len + 2);

  // parse out the json
  var js = {};
  if(len > 1)
  {
    try {
      js = JSON.parse(head.toString("utf8"));
    } catch(E) {
      console.log("couldn't parse JS",buf.toString("hex"),E);
      return undefined;
    }
  }
  return {js:js, length:buf.length, head:head.toString("binary"), body:body};
}

function getkey(id, csid)
{
  return id.cs && id.cs[csid] && id.cs[csid].key;
}

function loadkeys(self)
{
  self.cs = {};
  self.keys = {};
  self.parts = {};
  var err = false;
  Object.keys(self.id).forEach(function(csid){
    if(csid.length != 2) return; // only csid keys
    self.cs[csid] = {};
    if(!self.CSets[csid]) err = csid+" not supported";
    err = err||self.CSets[csid].loadkey(self.cs[csid], self.id[csid], self.id[csid+"_secret"]);
    self.keys[csid] = self.id[csid];
    self.parts[csid] = crypto.createHash("sha256").update(self.cs[csid].key).digest("hex");
  });
  return err;
}

function loadkey(self, id, csid, key)
{
  id.csid = csid;
  return self.CSets[csid].loadkey(id, key);
}

function keysgen(cbDone,cbStep)
{
  var self = this;
  var ret = {};
  var todo = Object.keys(self.CSets);
  if(todo.length == 0) return cbDone("no sets supported");
  function pop(err)
  {
    if(err) return cbDone(err);
    var csid = todo.pop();
    if(!csid){
      self.load(ret);
      return cbDone(null, ret);
    }
    self.CSets[csid].genkey(ret,pop,cbStep);
  }
  pop();
}

function ticketize(self, to, inner)
{
  if(!to.csid)
  {
    console.log("can't ticket w/ no key");
    return false;
  }
  // clone the recipient CS stuff to gen new ephemeral line state
  var tcs = {};
  self.CSets[to.csid].loadkey(tcs,to.key);
  return self.CSets[to.csid].openize(self, tcs, pencode(inner));
}

function deticketize(self, from, open)
{
  var ret;
  var csid = open.head.charCodeAt().toString(16);
  if(!self.CSets[csid] || csid != from.csid) ret = {err:"invalid CSID of "+csid};
  else{
    open.from = from;
    try{ret = self.CSets[csid].deopenize(self, open);}catch(E){ret = {err:E};}    
  }
  if(ret.err || !ret.inner)
  {
    debug("deticketize failed",ret.err);
    return false;
  }
  return ret.inner;
}

function openize(self, to)
{
  if(!to.csid)
  {
    console.log("can't open w/ no key");
    return undefined;
  }
  if(!to.lineOut) to.lineOut = randomHEX(16);
  if(!to.lineAt) to.lineAt = Date.now();
  var inner = {}
  inner.at = to.lineAt; // always the same for the generated line id/key
  inner.to = to.hashname;
  inner.from = self.parts;
  inner.line = to.lineOut;
  return self.CSets[to.csid].openize(self, to, inner);
}

function deopenize(self, open)
{
//  console.log("DEOPEN",open.body.length);
  var ret;
  var csid = open.head.charCodeAt().toString(16);
  if(!self.CSets[csid]) return {err:"unknown CSID of "+csid};
  try{ret = self.CSets[csid].deopenize(self, open);}catch(E){return {err:E};}
  ret.csid = csid;
  return ret;
}

var urllib = require("url");
function uriparse(uri)
{
  // node's uri parser enforces dns max 63 chars per label, grr!
  if(typeof uri !== "string") uri = "";
  var hashname = uri.match(/[0-9A-Fa-f]{64}/);
  if(!hashname) return urllib.parse(uri);
  var full = hashname[0];
  var part = full.substr(0,32);
  var u = urllib.parse(uri.replace(full,part));
  if(u.hostname != part) return urllib.parse(uri); // hashname was not the hostname
  Object.keys(u).forEach(function(k){
    if(typeof u[k] != "string") return;
    u[k] = u[k].replace(part,full);
  });
  return u;
}
