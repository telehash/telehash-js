var crypt = require("./crypt");
var thjs = require("thjs");
var dgram = require("dgram");

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
    var buf = new Buffer(msg, "binary");
    self.server.send(buf, 0, buf.length, to.port, to.ip);
  }, args);
  if(!self) return false;
  self.server = dgram.createSocket("udp4", function(msg, rinfo){
    self.receive(msg.toString("binary"), {ip:rinfo.address, port:rinfo.port});
  });
  self.server.bind(self.port, self.ip, function(){
    // update address after listen completed to be besty
    self.port = self.server.address().port;
  });
  return self;
}
