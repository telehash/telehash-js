# Overview

[![Build Status](https://travis-ci.org/telehash/node-telehash.svg?branch=v3)](https://travis-ci.org/telehash/node-telehash)

[![telehash](https://nodei.co/npm/telehash.png)](https://nodei.co/npm/telehash/)

This module presents a simple high-level API for using [telehash v3](https://github.com/telehash/telehash.org/tree/v3/v3) for both node and browserify.

The browser crypto that powers this is only possible thanks to the incredible work done by the team behind [Forge](https://github.com/digitalbazaar/forge), [Tom Wu](http://www-cs-students.stanford.edu/~tjw/), and the [Sanford Javascript Crypto Library](https://github.com/bitwiseshiftleft/sjcl).

# Router

Telehash apps usually need one or more routers to assist in establishing p2p connections, there are some test ones in [mesh.json](mesh.json).  You can run your own router via `npm start`, manually via `node bin/router.js`, or just `router` if you did an `npm install -g`.  The JSON object from the router output can be passed in to the `mesh.router({...})` function (shown below) or stored in your own `mesh.json`.

# Library Interface

## Local Endpoint Identity Generation

To create a new hashname:

```js
var th = require("telehash");
th.generate(function(err, endpoint){
  if(err) return console.log("endpoint generation failed",err);
  // endpoint contains a `keys:{}`, `secrets:{}`, and `hashname:"..."` 
});
```

## Mesh Initialization / Startup

Needs an endpoint object from a previously run `generate()` to initialize from:

```js
var th = require("telehash");
th.mesh({id:endpoint}, function(err, mesh){
  if(err) return console.log("mesh failed to initialize",err);
  // use mesh.* now
});
```

The first object passed in to the `mesh` function takes the following arguments:

* **id** - An endpoint object previously created, or a string pointing to a file to load the object from.
* **mesh** - An object in the [mesh json](https://github.com/telehash/telehash.org/blob/master/json.md) format, or a string pointing to a json file to load from.

## Establishing Links

With just a hashname (requires a router to assist):

````js
var link = mesh.link(hashname);
// always offline by default, signals when up
link.up = function(online){
  if(online) {
    console.log('connected');
    // can do any other link.* methods
  }
};
````

Can establish a link directly:
````js
var link = mesh.link({keys:{},paths:{}});
````

### Authorizing Links (optional)

To send a custom packet or validate one with any link request, pass a function for the second argument to `.link()`:

````js
var link = mesh.link(hashname, function(incoming, cb){
  // incoming is an inbound link packet, or false when generating an initial outgoing packet
  // cb(err, outgoing) to respond, any err will mark the link offline or outgoing is online (once mutual)
});
````


## Routing

One or more routers can be used by default to help establish all links, and/or they can be added individually to each link.

````js
mesh.router({keys:{},paths:{}}); // for all links
link.router({keys:{},paths:{}}); // for just this link
mesh.router(link); // an existing link can be passed in instead
link.route(true); // enable being a router to this link for anyone in the mesh
mesh.route(true); // to route for everyone on the mesh
````

## Discovery Mode

Links can only be established by default when the other endpoint's identity is known ahead of time unless discovery mode is enabled. This mode enables a server model where one endpoint can accept new links from unknown ones.  Discovery mode also enables any supported transport to announce and discover other endpoints also in discovery mode that are available on a local network (for pairing).

````js
mesh.discover({discover:callback},cb); // callback({hashname:'',keys:{},paths:{}}) is called for any discovered hashname, use .link to accept or ignore to deny
````

## Extensions

Most functionality is added by extending the core library to support additional channels and expose more methods. The built-in extensions live in the [lib](lib/) folder, but additional ones can be added by the app.

Extensions typically involve:

* handling one or more channel types
* adding one or more methods to a created mesh instance
* adding one or more methods to every link instance within a mesh
* providing a transport

Using an interface like:

````
var ext = require('ext');
ext.name; // unique string name for debugging
telehash.add(ext); // just does telehash.extensions[ext.name] = ext; 
mesh.extend(ext,cb); // or per mesh, auto-run for all .extensions
// calls:
if(ext.mesh) ext.mesh(mesh, cb(err));
if(ext.link) ext.link(link, cb(err));
````


## Transports

All transports are implemented as an extension that exposes the functionality of:

* turnin a path into a pipe, pipe has a path (if any)
* incoming packets with a pipe
* outgoing packets to a pipe
* pipe event of keepalive, closed, and changed
* return available source paths
* enable discovery mode

Using an interface like:

````
var tpx = require('telehash-x');
// mesh.receive = function(packet,pipe){ };
tpx.mesh(mesh,function(err, tp){
  tp.pipe(path, function(pipe){
    pipe.path; // current json object (if addressable)
    pipe.on('keepalive', function(){}) // adds callback, return false to unregister, called on all events
    pipe.send(packet)
  });
  var paths = tp.paths(); // return array of current addressible paths, if any
  tp.discover({packet:packet}, cb); // enables/disables discovery mode, will create new pipes for incoming, cb when done
});
````


