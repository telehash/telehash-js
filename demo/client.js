var fs = require("fs");
var tele = require("../telehash");

// what is our operator, pass in or replace this value
var opaddress = process.argv[2];

// load up our private key
var ckeys = require("./client.json");

// start up our client hashname in the same space
var client = tele.hashname("testing.private", ckeys);

// provide the operator(s) for this hashname
client.setOperators([opaddress]);

// ask for ourselves, which will query the operator
client.doWho(client.hashname, function(err, pubkey){
	if(err) return console.log("failed to find our hashname in this space:", err);
	if(pubkey !== ckeys.public) return console.log("odd, our keys didn't match"); 
	console.log("great, we're connected! our address is", client.address);
});
