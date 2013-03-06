var dgram = require('dgram');
var sock = dgram.createSocket("udp4");

var json = new Buffer(process.argv[3], "utf8");
var msg = new Buffer(json.length+2);
msg.writeInt16BE(json.length,0);
json.copy(msg,2);
var address = process.argv[2].split(",");
sock.send(msg, 0, msg.length, parseInt(address[2]), address[1]);

