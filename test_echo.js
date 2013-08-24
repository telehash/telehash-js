var dgram = require("dgram");

if(!process.argv[2])
{
  console.log("node test_packet.js port");
  process.exit(1);
}

var server = dgram.createSocket("udp4");
server.on("message", function (msg, rinfo) {
  var packet = decode(msg);
  console.log("packet json",JSON.stringify(packet.js),"and body '"+packet.body.toString("utf8")+"' from",rinfo.address + ":" + rinfo.port);
  var echo = encode(packet.js, packet.body);
  server.send(echo, 0, echo.length, rinfo.port, rinfo.address, function(err, bytes) {
    console.log("echo'd",bytes,"bytes:",echo);
  });
});

server.on("listening", function () {
  var address = server.address();
  console.log("echo listening " + address.address + ":" + address.port);
});

server.bind(process.argv[2]);

function encode(js, body)
{
  var jsbuf = new Buffer(JSON.stringify(js), "utf8");
  if(typeof body === "string") body = new Buffer(body, "utf8");
  body = body || new Buffer(0);
  var len = new Buffer(2);
  len.writeInt16BE(jsbuf.length, 0);
  return Buffer.concat([len, jsbuf, body]);
}

function decode(buf)
{
  // read and validate the json length
  var len = buf.readUInt16BE(0);
  if(len == 0 || len > (buf.length - 2)) return undefined;

  // parse out the json
  var packet = {js:{}};
  try {
      packet.js = JSON.parse(buf.toString("utf8",2,len+2));
  } catch(E) {
    return undefined;
  }

  // if any body, attach it as a buffer
  if(buf.length > (len + 2)) packet.body = buf.slice(len + 2);
 
  return packet;
}
