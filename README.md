# Overview

This module presents a simple high-level API for using [telehash v2](https://github.com/quartzjer/TeleHash/blob/master/org/v2.md).

Every instance of an app using telehash is identified by a unique `hashname` which is a combination of an RSA public key and a hostname for the `network` it's part of.  Every network must have one or more publicly accessible hashnames that can serve as seeds to help any new hashname get connected. The list of seeds is bundled with every app.

# From Scratch

To create an entire standalone setup you'll need a network with at least one seed and one other hashname for them to connect to each other.  A network is typically identified with a domain name to ensure it's unique.  These examples are also included in the demo folder.

Start by generating two RSA keypairs:

``` js
var tele = require("..");
var fs = require("fs");
tele.genkey(function(err, key){
  fs.writeFileSync("./seed.json", JSON.stringify(key, null, 4));  
});
tele.genkey(function(err, key){
  fs.writeFileSync("./app.json", JSON.stringify(key, null, 4));  
});
```

Then start up the seed:
``` js
var tele = require("telehash");
var key = require("./seed.json"); // loads the keypair

// start a new hashname in the given space with these keys, listen on this specific port
var seed = tele.hashname("testing.telehash.org", key, {port:42424});
console.log("seed online at", seed.ip+":"+seed.port, "for the network", seed.network, "with the hashname", seed.hashname);
```

Now start the test app:
``` js
var tele = require("telehash");
var seed = require("./seed.json");
var app = tele.hashname("testing.telehash.org", require("./app.json"));
app.addSeed({ip:"localhost", port:42424, pubkey:seed.public});
app.online(function(err){
  console.log("app online status", err?err:true);
});
```
