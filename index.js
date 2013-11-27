var crypt = require("./crypt");
var thjs = require("thjs");
var dgram = require("dgram");
var os = require("os");

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
