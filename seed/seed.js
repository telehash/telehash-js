#!/usr/bin/env node

var fs = require("fs");
var os = require("os");
var path = require("path");
var tele = require("../index");
var argv = require("optimist")
  .default("id", "./seed.json")
  .default("port", 42424)
  .boolean("bridge").default(true)
  .boolean("v").describe("v", "verbose")
  .describe("ip", "force set the public IP address to override any NAT detection")
  .argv;

if(argv.v) tele.debug(console.log);

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
  var seed = tele.hashname(key, {port:parseInt(argv.port), ip:argv.ip});
  if(argv.seeds) seed.addSeeds(argv.seeds);
  if(argv.http) seed.http(argv.http, require('socket.io').listen(parseInt(argv.http.split(":").pop())));
  if(argv.http || argv.bridge) seed.bridging = true; // enable bridging
  seed.online(function(err){
    var ip = seed.pubip||seed.ip;
    var port = seed.pubport||seed.port;
    var info = {ip:ip, port:port, hashname:seed.hashname, pubkey:key.public};
    if(argv.http) info.http = argv.http;
    if(seed.bridging) info.bridge = true;
    console.log(JSON.stringify(info, null, 4));
    if(seed.nat) console.log("warning, may be behind a NAT, IP and Port may not be stable");
    console.log((err?err:"connected to mesh seed peers"));
  });
}
