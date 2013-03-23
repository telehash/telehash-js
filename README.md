# Overview

This module presents a simple high-level API for using [telehash v2](https://github.com/quartzjer/TeleHash/blob/master/org/v2.md).

Every "actor" within telehash is called a `hashname` which is an RSA keypair listening on an IP/Port that is part of a `space`, a collection of hashnames that share some trust or identity.  Every space must have one or more publicly accessible hashnames that can serve as an `operator` for that space to help any new hashname get connected, the seed list of operators for a space is typically bundled with an app.

# From Scratch

To create an entire standalone setup you'll need a space with at least one operator and one hashname for them to connect to each other.  A space should be identified with a fully qualified hostname or for private/testing ones use "****.private".  These examples are also included in the demo folder.

Start by generating two RSA keypairs (need to `npm install ursa` first):

``` js
var key = require("ursa").generatePrivateKey();
require('fs').writeFileSync("./operator.json", JSON.stringify({public:key.toPublicPem("utf8"), private:key.toPrivatePem("utf8")}, null, 4));
var key = require("ursa").generatePrivateKey();
require('fs').writeFileSync("./client.json", JSON.stringify({public:key.toPublicPem("utf8"), private:key.toPrivatePem("utf8")}, null, 4));
```

Then start up the operator:
``` js
var tele = require("../telehash");
var opkeys = require("./operator.json"); // loads the keypair

// start a new hashname in the given space with these keys, listen on this specific port
var operator = tele.hashname("testing.private", opkeys, {port:42424});
console.log("operator address is ", operator.address);

// operators need to resolve other keys in the same space, so provide a callback to do that for our client.json
// this is typically done via a key-value store or other means dynamically, here we only have one
var ckeys = require("./client.json");
var chashname = tele.hash(ckeys.public+"testing.private").toString();
operator.myLookup(function(hashname, callback){
	if (hashname === chashname) return callback(null, ckeys.public);
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
```
