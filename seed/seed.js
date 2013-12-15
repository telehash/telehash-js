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
  .boolean("nolan").describe("nolan", "disable lan usage")
  .describe("ip", "force set the public IP address to override any NAT detection")
  .argv;

if(argv.v) tele.debug(console.log);

if(argv.port == 42420)
{
  console.log("that port is reserved");
  process.exit(1);
}

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
  var seed = tele.hashname(key, {port:parseInt(argv.port), ip:argv.ip, nolan:argv.nolan});
  if(argv.seeds) seed.addSeeds(argv.seeds);
  if(argv.http) seed.http(argv.http, require('socket.io').listen(parseInt(argv.http.split(":").pop())));
  if(argv.http || argv.bridge) seed.bridging = true; // enable bridging
  seed.online(function(err){
    var lan4 = seed.paths.lan4 || {};
    var pub4 = seed.paths.pub4 || {};
    var ip = pub4.ip||lan4.ip;
    var port = pub4.port||lan4.port;
    var info = {ip:ip, port:port, ip6:seed.paths.lan6.ip, port6:seed.paths.lan6.port, hashname:seed.hashname, pubkey:key.public};
    if(argv.http) info.http = argv.http;
    if(seed.bridging) info.bridge = true;
    console.log(JSON.stringify(info, null, 4));
    if(seed.nat) console.log("warning, may be behind a NAT, IP and Port may not be stable");
    console.log((err?err:"connected to mesh seed peers"));
  });
}
