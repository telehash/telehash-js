# Overview

This module presents a simple high-level API for using [telehash v2](https://github.com/quartzjer/TeleHash/blob/master/org/v2.md).

Every "actor" within telehash is called a `hashname` which is an RSA keypair listening on an IP/Port that is part of a `space`, a collection of hashnames that share some trust or identity.  Every space must have one or more publicly accessible hashnames that can serve as an `operator` for that space to help any new hashname get connected, the seed list of operators for a space is typically bundled with an app.

# From Scratch

To create an entire standalone setup you'll need a space with at least one operator and one hashname for them to connect to each other.  A space should be identified with a fully qualified hostname or for private/testing ones use "****.private".

Start by generating two RSA keypairs, [rsa-json](http://github.com/substack/rsa-json) make this really easy:

```
npm install -g rsa-json
rsa-json > operator.json
rsa-json > client.json
```

Then start up the operator:
``` js
var tele = require("telehash");
var opkeys = require("./operator.json"); // loads the keypair

// start a new hashname in the given space with these keys, listen on this specific port
var operator = tele.hashname("testing.private", opkeys, {port:42424});
console.log("operator address is ", operator.address);

// operators need to resolve other keys in the same space, so provide a callback to do that for our client.json
// this is typically done via a key-value store or other means dynamically, here we only have one
var ckeys = require("./client.json");
var chash = tele.hash(ckeys.public+"testing.private").toString();
operator.lookup(function(hashname, callback){
	if (hashname === chash) return callback(null, ckeys.public);
	callback("not found");
});
```

Now start the test client:
``` js
var tele = require("telehash");
var ckeys = require("./client.json");

// start up our client hashname
var client = tele.hashname("testing.private", ckeys);
console.log("client address is ", operator.address);

// provide the operator(s) for this hashname
client.operators(["address from above"]);

// ask for ourselves, which will query the operator
client.who(client.hashname, "testing.private", function(err, key){
	if (err) console.log("failed to find our hashname in this space", err);
	else console.log("great, we're connected! our address is", client.address);
});
```
