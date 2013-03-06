var dgram = require('dgram');
var os = require('os');
var hash = require('./hash').Hash;

// just combines the name of a space and a public key into a hashname
exports.makeHashname = function(space, key)
{
  if(!space || !key) return undefined;
  return new hash(space+key).toString();
}

// start a hashname listening and ready to go
exports.listen = function(space, keys, args)
{
  if(!space || !keys || !keys.public || !keys.private) return undefined;
  if(!args) args = {};

  // configure defaults
  var self = {space:space, keys:keys};
  self.hashname = exports.makeHashname(space, keys.public);
  if (!args.ip || args.natted) self.nat = true;
  self.ip = args.ip || "0.0.0.0";
  self.port = parseInt(args.port) || 0;

  // udp socket
  self.server = dgram.createSocket("udp4", function(msg, rinfo){
    var from = rinfo.address + ":" + rinfo.port;
    var packet = decode(msg);
    if(!packet) return console.log("failed to decode a packet from", from);
    packet.from = from;
    incoming(self, packet);
  });
  self.server.bind(self.port, self.ip);

  // try to set the correct address for logging, not important for telehash
  self.port = self.server.address().port;
  if(self.ip == "0.0.0.0") {
    var better;
    var ifaces = os.networkInterfaces()
    for (var dev in ifaces) {
      ifaces[dev].forEach(function(details){
        if(!better && details.family == "IPv4" && dev.substr(0,1) == "e") better = details.address;
      });
    }
    if(better) self.ip = better;
  }
  self.address = [self.hashname, self.ip, self.port].join(",");

  return self;
}

// decode a packet from a buffer
function decode(buf)
{
  // read and validate the json length
  var len = buf.readUInt16BE(0);
  if(len == 0 || len > (buf.length - 2)) return undefined;

  // parse out the json
  var packet = {};
  try {
      packet.json = JSON.parse(buf.toString("utf8",2,len+2));
  } catch(E) {
    return undefined;
  }
  
  // if any body, attach it as a buffer
  if(buf.length > (len + 2)) packet.body = buf.slice(len + 2);
  
  return packet;
}

// figure out what this packet is and have some fun
function incoming(self, packet)
{
  console.log(self.address, "packet from", packet.from, packet.json);
}