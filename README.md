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
// will be called when link status changes, err is undefined when link is up
link.status(function(err){
  if(err) {
    console.log('disconnected',err);
    return;
  }
  console.log('connected');
  // can do any other link.* methods
});
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

By default every mesh will allow routing between any of its active links to assist in p2p connectivity.

One or more routers can be used by default to help establish all links, and/or they can be added individually to each link.

````js
mesh.router(link); // any link can be used as a default router
mesh.link({...,router:true}); // another way to set a link as a default router from the start

link.router(link); // just one link can be used as a router for another
mesh.link({...,paths:[{type:'peer',hn:'linked'}]}); // including a peer path to an already-linked hn will automatically use it as a router
````

Whenever a default router is added, it will also be advertised to other links as a peer path for this endpoint.

## Discovery Mode

By default links can only be established with a known hashname, which requires apps to have an independent way to exchange hashnames beforehand. Discovery mode enables a server model where an endpoint can accept links from new hashnames it doesn't know yet.  This means that the endpoint will reveal itself to unknown and not-yet-trusted hashnames, it can be discovered by anyone with access to a local network or it's network information so the mode should be used sparingly or only in public server models.

Discovery mode also enables any supported network transport to announce and discover other endpoints that are simultaneously discoverable locally. This can be used for initial pairing of two hashnames.

````js
mesh.discover(true); // to enable
mesh.discover(false); // to disable (default)
````

Optional args and a callback (to know once discovery is enabled on all the transports) can be passed in:

````js
mesh.discover({args},done);
````

The args can include:

* `discover:callback` - upon discovering any hashname this callback is given the info of `callback({hashname:'',keys:{},paths:{}})` and there is no response unless it is passed to `mesh.link(from)`
* `announce:bool` - any transport that can send broadcasts locally will do so (defaults to `true`), incoming announcements will still be discovered when `false`
* custom per-transport discovery options may be passed in

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


