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
  var self = thjs.hashname(key, function(to, msg){
    var buf = Buffer.isBuffer(msg) ? msg : new Buffer(msg.data, "binary");
    self.server.send(buf, 0, buf.length, to.port, to.ip);
  }, args);
  if(!self) return false;
  
  // to be nice, background-load seeds if none were set
  self._addSeed = self.addSeed;
  self.addSeed = function(arg){
    self.seeded = true;
    return self._addSeed(arg);
  }
  // add local auto seed file loading
  self.addSeeds = function(file)
  {
    require(file).forEach(self.addSeed, self);
  }
  // we trigger auto-loading seeds with an online
  self._online = self.online;
  self.online = function(callback)
  {
    if(!self.seeded) self.addSeeds(path.join(__dirname,"seeds.json"));
    return self._online(callback);
  }
  
  // do our udp server bindings
  self.server = dgram.createSocket("udp4", function(msg, rinfo){
    self.receive(msg.toString("binary"), {ip:rinfo.address, port:rinfo.port});
  });
  self.server.bind(self.port, self.ip, function(){
    // update port after listen completed to be accurate
    self.port = self.server.address().port;
    // regularly update w/ real local ipv4 address
    function interfaces()
    {
      var ifaces = os.networkInterfaces()
      for (var dev in ifaces) {
        ifaces[dev].forEach(function(details){
          if(details.family == "IPv4" && !details.internal) self.ip = details.address;
        });
      }
      setTimeout(interfaces,10000);
    }
    interfaces();
  });
  return self;
}
