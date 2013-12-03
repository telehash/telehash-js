#!/usr/bin/env node

var fs = require("fs");
var os = require("os");
var path = require("path");
var tele = require("../index");
var argv = require("optimist")
  .default("id", "./seed.json")
  .default("port", 42424)
  .boolean("v").describe("v", "verbose")
  .argv;

if(argv.v) tele.debug(console.log);

// use/get port and IP
var port = parseInt(argv.port);
var ip;
var ifaces = os.networkInterfaces();
for (var dev in ifaces) {
  for(var i in ifaces[dev])
  {
    var iface = ifaces[dev][i];
    if(iface.family == "IPv4" && !iface.internal) ip = iface.address;    
  }
}
if(argv.ip) ip = argv.ip;
if(!ip) return console.log("unable to determine IP address, use -ip '1.2.3.4' to set one.");

// localize our id file
var idfile = path.join(__dirname, argv.id);

// load the pub/private key or create one
if(fs.existsSync(idfile))
{
  init(require(idfile));
}else{
  tele.genkey(function(err, key){
    fs.writeFileSync(idfile, JSON.stringify(key, null, 4));
    init(key);
  });
}

function init(key)
{
  var seed = tele.hashname(key, {port:port, ip:ip});
  console.log(JSON.stringify({ip:seed.ip, port:seed.port, hashname:seed.hashname, pubkey:key.public}, null, 4));
  if(argv.seeds) seed.addSeeds(argv.seeds);
  seed.online(function(err){
    console.log((err?err:"connected to mesh seed peers"));
  });
}
