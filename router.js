#!/usr/bin/env node

var tele = require("./index.js");
var fs = require("fs");
var path = require("path-extra");
var argv = require("optimist")
  .default("port", 42424)
  .boolean("v").describe("v", "verbose")
  .argv;

if(argv.v) tele.debug(console.log);
tele.info(function(){console.log.apply(console,arguments)});

if(argv.port == 42420)
{
  console.log("that port is reserved");
  process.exit(1);
}

// localize our id file
argv.id = (argv.id) ? path.resolve(argv.id) : path.join(path.homedir(),".router.json");

tele.init(argv, function(err, router){
  if(!router) return console.log("something went wrong :(",err) || process.exit(1);
  var info = {paths:router.paths, parts:router.parts, keys:router.keys};
  
  var js = {};
  js[router.hashname] = info;
  console.log(JSON.stringify(js,null,2));
});
