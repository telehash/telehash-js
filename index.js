var thjs = require("thjs");
var dgram = require("dgram");
var os = require("os");
var path = require("path");

// load the pure-js and then try to load compiled ones
var crypt = require("./cryptjs").load();
require("./crypt").upgrade(crypt);
thjs.localize(crypt);

// optional debug flag
var debug = function(){};
exports.debug = function(cb){
  debug = cb;
  thjs.debug(cb);
}
exports.info = thjs.info;
exports.isLocalIP = thjs.isLocalIP;

exports.genkey = crypt.genkey;
exports.genkeys = function(cbDone,cbStep,sets)
{
  if(!sets) sets = {"1a":true,"2a":true,"3a":true}; // we do more
  crypt.genkeys(cbDone,cbStep,sets);
}

exports.hashname = function(key, args)
{
  if(!args) args = {};
  if(args.port == 42420)
  {
    console.log("can't use reserved port 42420");
    return false;
  }
  var self = thjs.hashname(key, function(to, msg){
    // since msg can come from crypt.js or thcrypt (or a raw bin string), flex
    var buf = Buffer.isBuffer(msg) ? msg : new Buffer(msg.data||msg, "binary");

    // blast the packet out on the lan with a temp socket
    if(to.type == "lan")
    {
      if(args.nolan) return;
      var lan = dgram.createSocket("udp4");
      lan.bind(self.server4.address().port, "0.0.0.0", function(err){
        lan.setBroadcast(true);
        // brute force to common subnets and all
        var parts = self.networkIP.split(".");
        for(var i = 3; i >= 0; i--)
        {
          parts[i] = "255";
          lan.send(buf, 0, buf.length, 42420, parts.join("."));
        }
        lan.send(buf, 0, buf.length, 42420, "239.42.42.42", function(){
          lan.close();
        });
      });
    }

    if(to.type == "ipv4") {
      self.server4.send(buf, 0, buf.length, to.port, to.ip);        
    }

    if(to.type == "ipv6") {
      self.server6.send(buf, 0, buf.length, to.port, to.ip);
    }

    if(to.type == "bridge" && self.io && self.io.sockets.sockets[to.id])
    {
      self.io.sockets.sockets[to.id].emit("packet", {data: buf.toString("base64")});
    }
  }, args);
  if(!self) return false;

  // when given an ip, force not in NAT mode
  if(args.ip) self.nat = false;
  
  // to be nice, background-load seeds if none were set
  self._addSeed = self.addSeed;
  self.addSeed = function(arg){
    self.seeded = true;
    return self._addSeed(arg);
  }
  // add local auto seed file loading
  self.addSeeds = function(file)
  {
    self.seeded = true;
    var seeds = require(file)
    Object.keys(seeds).map(function(hn){return seeds[hn]}).forEach(self.addSeed, self);
  }
  
  // optionally support http networks
  self.http = function(http, io)
  {
    if(http) self.pathSet({type:"http",http:http});
    self.io = io;
    io.on("connection", function(socket){
      socket.on("packet", function(packet) {
        if(!packet.data) return;
        self.receive((new Buffer(packet.data, "base64")).toString("binary"), {type:"bridge", id:socket.id});
      });
    });
  }
  
  // do our udp server bindings
  function msgs4(msg, rinfo){
    self.receive(msg.toString("binary"), {type:"ipv4", ip:rinfo.address, port:rinfo.port});
  }
  function msgs6(msg, rinfo){
    self.receive(msg.toString("binary"), {type:"ipv6", ip:rinfo.address, port:rinfo.port});
  }
  self.server4 = dgram.createSocket("udp4", msgs4);
  self.server6 = dgram.createSocket("udp6", msgs6);
    
  self.server4.on("error", function(err){
    console.log("error from the UDP socket",err);
    process.exit(1);
  });
  self._online = self.online;
  self.online = function(callback)
  {
    // we trigger auto-loading seeds with an online
    if(!self.seeded) self.addSeeds(path.join(__dirname,"/node_modules/thjs/seeds.json"));

    // ensure udp sockets are bound
    self.server4.bind(args.port, "0.0.0.0", function(){
      self.server6.bind(args.port, "::0", function(err){
        // regularly update w/ local ip address changes
        function interfaces()
        {
          var ifaces = os.networkInterfaces()
          var address4 = self.server4.address();
          var address6 = self.server6.address();
          for (var dev in ifaces) {
            ifaces[dev].forEach(function(details){
              // upgrade to actual interface ip, prefer local ones
              if(details.family == "IPv4" && !details.internal && thjs.isLocalIP(address4.address)) address4.address = details.address;
              if(details.family == "IPv6" && !details.internal && thjs.isLocalIP(address6.address)) address6.address = details.address;
            });
          }
          self.networkIP = address4.address; // used for local broadcasting above
          // allow overridden lan4 ip address
          if(args.ip) address4.address = args.ip;
          self.pathSet({type:"lan4",ip:address4.address,port:address4.port});
          self.pathSet({type:"lan6",ip:address6.address,port:address6.port});
          // set http url if not manually set
          if(self.io && !self.paths.http) self.pathSet({type:"http",http:"http://"+address4.address+":"+address4.port})
          setTimeout(interfaces,10000);
        }
        interfaces();

        if(args.nolan) return self._online(callback);        
      
        // start the lan * listener, only ipv4 for now, can't find docs on node+ipv6 multicast
        var lan = dgram.createSocket("udp4", msgs4);
        lan.bind(42420, "0.0.0.0", function(err){
          lan.setMulticastLoopback(true)
          lan.addMembership("239.42.42.42");
          lan.setBroadcast(true);
          // fire up switch
          self._online(callback);        
        });
      });
    });
  }
  
  return self;
}

// use node streams
thjs.channelWraps.stream = function(chan)
{
  chan.duplex = new require("stream").Duplex();

  // allow for manually injected json
  duplex.bufJS = {};
  duplex.js = function(js){
    Object.keys(js).forEach(function(key){ duplex.bufJS[key] = js[key]; });
    setTimeout(doChunk, 10);
  };
  
  // buffer writes and chunk them out
  duplex.bufBody = new Buffer(0);
  duplex.cbWrite;

  function doChunk(){
    debug("CHUNKING", duplex.bufJS, duplex.bufBody.length)
    if(duplex.bufBody.length === 0 && Object.keys(duplex.bufJS).length === 0) return;      
    var bodyout;
    var jsout = duplex.bufJS;
    duplex.bufJS = {};
    if(duplex.bufBody.length > 0)
    {
      var len = 1024 - JSON.stringify(jsout).length; // max body size for a packet
      if(duplex.bufBody.length < len) len = duplex.bufBody.length;
      bodyout = duplex.bufBody.slice(0, len);
      duplex.bufBody = duplex.bufBody.slice(len);
    }
    // send it!
    sendStream(self, stream, {js:jsout, body:bodyout, done:function(){
      // we might be backed up, let more in
      if(duplex.cbWrite)
      {
        // am I being paranoid that a cbWrite() could have set another duplex.cbWrite?
        var cb = duplex.cbWrite;
        delete duplex.cbWrite;
        cb();
      }
    }});
    // recurse nicely
    setTimeout(doChunk, 10);
    
  };

  duplex.end = function(){
    duplex.bufJS.end = true;
    if(stream.errMsg) duplex.bufJS.err = stream.errMsg;
    doChunk();
  }

  duplex._write = function(buf, enc, cbWrite){
    duplex.bufBody = Buffer.concat([duplex.bufBody, buf]);

    // if there's 50 packets waiting to be confirmed, hold up here, otherwise buffer up
    var cbPacket = doChunk;
    if(stream.outq.length > 50)
    {
      duplex.cbWrite = cbWrite;
    }else{
      cbWrite();
    }
    
    // try sending a chunk;
    doChunk();
  }  
  
  duplex._read = function(size){
    // TODO handle backpressure
    // perform duplex.push(body)'s if any waiting, if not .push('')
    // handle return value logic properly
  };

  stream.handler = function(self, packet, cbHandler) {
    // TODO migrate to _read backpressure stuff above
    debug("HANDLER", packet.js)
    if(cbExtra) cbExtra(packet);
    if(packet.body) duplex.push(packet.body);
    if(packet.js.end) duplex.push(null);
    cbHandler();
  }
  return duplex;  
}
