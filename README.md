# Overview

This module presents a simple high-level API for using [telehash v2](https://github.com/quartzjer/TeleHash/blob/master/org/v2.md).

Every instance of an app using telehash is identified by a unique `hashname` which is a combination of an RSA public key and a hostname for the `network` it's part of.  Every network must have one or more publicly accessible hashnames that can serve as an `operator` to help any new hashname get connected. The list of operators for a network is typically resolved via DNS (SRV) of the network's hostname or simply bundled/seeded with an app.

# From Scratch

To create an entire standalone setup you'll need a network with at least one operator and one other hashname for them to connect to each other.  A network should be identified with a fully qualified hostname, but for private/testing ones use "****.private".  These examples are also included in the demo folder.

Start by generating two RSA keypairs:

``` js
var key = require("ursa").generatePrivateKey();
require('fs').writeFileSync("./operator.json", JSON.stringify({publicKey:key.toPublicPem("utf8"), privateKey:key.toPrivatePem("utf8")}, null, 4));
var key = require("ursa").generatePrivateKey();
require('fs').writeFileSync("./client.json", JSON.stringify({publicKey:key.toPublicPem("utf8"), privateKey:key.toPrivatePem("utf8")}, null, 4));
```

Then start up the operator:
``` js
var tele = require("../telehash");
var opkeys = require("./operator.json"); // loads the keypair

// start a new hashname in the given network with these keys, listen on this specific port
var operator = tele.hashname("testing.private", opkeys, {port:42424});
console.log("operator address is ", operator.address);

// operators need to resolve other keys in the same network, so provide a callback to do that for our client.json
// this is typically done via a key-value store or other means dynamically, here we only have one
var ckeys = require("./client.json");
var chashname = tele.hash(ckeys.publicKey+"testing.private").toString();
operator.myLookup(function(hashname, callback){
	if (hashname === chashname) return callback(null, ckeys.publicKey);
	callback("not found");
});
```

Now start the test client:
``` js
var fs = require("fs");
var tele = require("../telehash");

// what is our operator, pass in or replace this value
var opaddress = process.argv[2];

// load up our private key
var ckeys = require("./client.json");

// start up our client hashname in the same network
var client = tele.hashname("testing.private", ckeys);

// provide the operator(s) for this hashname
client.setOperators([opaddress]);

// ask for ourselves, which will query the operator
client.doWho(client.hashname, function(err, pubkey){
	if(err) return console.log("failed to find our hashname in this network:", err);
	if(pubkey !== ckeys.publicKey) return console.log("odd, our keys didn't match"); 
	console.log("great, we're connected! our address is", client.address);
});
```
