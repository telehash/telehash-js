var fs = require("fs");
var tele = require("..");
//tele.debug(function(){}); // disable any debug output for now

// what is the operator running, pass in or replace this value
var opIPPort = process.argv[2];
var opPubkey = require("./operator.json").public;

// load up our private key
var ckeys = require("./client.json");

// create a client hashname in the test space
var client = tele.hashname("testing.private", ckeys);

// provide the operator(s) for this hashname
client.addOperator(opIPPort, opPubkey);

console.log("client hashname created", client.address, "connecting to operator...");

// go online
client.online(function(err){
  console.log("client online status", err?err:true);
});
