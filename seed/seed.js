#!/usr/bin/env node

var fs = require("fs");
var os = require("os");
var path = require("path");
var tele = require("../index");
var argv = require("optimist")
  .default("id", "./seed.json")
  .default("port", 42424)
  .boolean("bridge").default("bridge",true)
  .boolean("v").describe("v", "verbose")
  .boolean("nolan").describe("nolan", "disable lan usage")
  .string("cs").describe("cs", "cipher sets to generate id with, comma delim")
  .describe("ip", "force set the public IP address to override any NAT detection")
  .argv;

if(argv.v) tele.debug(console.log);
tele.info(function(){console.log.apply(console,arguments)});
var sets;
if(typeof argv.cs == "string")
{
  sets = {};
  argv.cs.split(",").forEach(function(cs){sets[cs]=true});
}

if(argv.port == 42420)
{
  console.log("that port is reserved");
  process.exit(1);
}

// localize our id file
var idfile = path.join(__dirname, argv.id);

// load the pub/private key or create one
var keys;
if(fs.existsSync(idfile) && (keys = require(idfile)) && keys.parts)
{
  init(keys);
}else{
  tele.genkeys(function(err, keys){
    fs.writeFileSync(idfile, JSON.stringify(keys, null, 4));
    init(keys);
  },false,sets);
}

function init(keys)
{
  var seed = tele.hashname(keys, {port:parseInt(argv.port), ip:argv.ip, nolan:argv.nolan});
  if(!seed) return console.log("something went wrong :(");
  if(argv.seeds) seed.addSeeds(argv.seeds);
  if(!argv.nohttp) seed.http(argv.http, require('socket.io').listen(argv.port, {log:false}));
  seed.bridging = argv.bridge;
  seed.online(function(err,count){
    var lan4 = seed.paths.lan4 || {};
    var pub4 = seed.paths.pub4 || {};
    var ip = pub4.ip||lan4.ip;
    var port = pub4.port||lan4.port;
    var info = {paths:[], hashname:seed.hashname, parts:seed.parts, keys:seed.keys};
    info.paths.push({type:"ipv4",ip:ip,port:port});
    if(seed.paths.lan6) info.paths.push({type:"ipv6",ip:seed.paths.lan6.ip,port:seed.paths.lan6.port});
    if(!argv.nohttp) info.paths.push({type:"http",http:seed.paths.http.http});
    if(seed.bridging) info.bridge = true;
    console.log("[\n\t"+JSON.stringify(info)+"\n]");
    if(seed.nat) console.log("warning, may be behind a NAT, IP and Port may not be stable");
    console.log((err?err:"connected to "+count+" mesh seed peers"));
  });
}
