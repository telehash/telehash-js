var crypt = require("./crypt");
var thjs = require("thjs");
var dgram = require("dgram");
var os = require("os");
var path = require("path");

// use either the crypt (compiled, faster) libs or the forge-based pure js ones
if(!crypt.validate()) crypt = require("./cryptjs").load();
thjs.localize(crypt);

// optional debug flag
var debug = function(){};
exports.debug = function(cb){
  debug = cb;
  thjs.debug(cb);
}

exports.genkey = crypt.genkey;

exports.hashname = function(key, args)
{
  if(!args) args = {};
  var self = thjs.hashname(key, function(to, msg){
    var buf = Buffer.isBuffer(msg) ? msg : new Buffer(msg.data, "binary");
    self.server.send(buf, 0, buf.length, to.port, to.ip);
  }, args);
  if(!self) return false;
  if(args.pubip) self.ip = args.pubip;
  
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
    require(file).forEach(self.addSeed, self);
  }
  // we trigger auto-loading seeds with an online
  self._online = self.online;
  self.online = function(callback)
  {
    if(!self.seeded) self.addSeeds(path.join(__dirname,"/node_modules/thjs/seeds.json"));
    return self._online(callback);
  }
  
  // do our udp server bindings
  self.server = dgram.createSocket("udp4", function(msg, rinfo){
    self.receive(msg.toString("binary"), {ip:rinfo.address, port:rinfo.port});
  });
  self.server.on("error", function(err){
    console.log("error from the UDP socket",err);
    process.exit(1);
  })
  self.server.bind(args.port, args.ip, function(){
    // update port after listen completed to be accurate
    self.port = self.server.address().port;
    if(args.pubip) return;
    if(args.ip && args.ip != "0.0.0.0") return;
    // if no ip is force set (useful for seed style usage), regularly update w/ local ipv4 address
    function interfaces()
    {
      var ifaces = os.networkInterfaces()
      for (var dev in ifaces) {
        ifaces[dev].forEach(function(details){
          if(details.family == "IPv4" && !details.internal) self.setIP(details.address);
        });
      }
      setTimeout(interfaces,10000);
    }
    interfaces();
  });
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
