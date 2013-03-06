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
var telehash = require("telehash");

// first create the operator and start it
var operator = require("./operator.json"); // loads the keypair
operator.space = "testing.private"; // sets what space to be an operator for
var ophash = telehash.hashname(operator);
ophash.listen({port:42424}); // can provide a {port:1234, ip:5.6.7.8} argument, listens to *:random by default
console.log("operator address is ", ophash.address);

// operators need to resolve other keys in the same space, so provide a callback to do that for our client.json
// this is typically done via a key-value store or other means dynamically, here we only have one
var client = require("./client.json");
client.space = "testing.private";
var chash = telehash.hashname(client);
ophash.lookup(function(hashname, callback){
	if (hashname === chash.hashname) return callback(null, chash.public);
	callback("not found");
});
```

Now start the test client:
``` js
var telehash = require("telehash");

// load the operator address for our space
telehash.space("testing.private", ["address printed above"]);

// start the test client
var client = require("./client.json");
client.space = "testing.private";
var chash = telehash.hashname(client);
chash.listen();
chash.spacer(function(err){
	if (err) console.log("failed to join our space", err);
	else console.log("great, we're connected! our address is", chash.address);
});
```
