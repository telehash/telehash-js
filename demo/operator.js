var tele = require("../telehash");
var opkeys = require("./operator.json"); // loads the keypair

// start a new hashname in the given space with these keys, listen on this specific port
var operator = tele.hashname("testing.private", opkeys, {port:42424});
console.log("operator address is ", operator.address);

// operators need to resolve other keys in the same space, so provide a callback to do that for our client.json
// this is typically done via a key-value store or other means dynamically, here we only have one
var ckeys = require("./client.json");
var chashname = tele.hash(ckeys.publicKey+"testing.private").toString();
operator.myLookup(function(hashname, callback){
	if (hashname === chashname) return callback(null, ckeys.publicKey);
	callback("not found");
});
