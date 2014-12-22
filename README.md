# Overview

[![Build Status](https://travis-ci.org/telehash/telehash-js.svg?branch=v3)](https://travis-ci.org/telehash/telehash-js)

[![telehash](https://nodei.co/npm/telehash.png)](https://nodei.co/npm/telehash/)

This module presents a simple high-level API for using [telehash v3](https://github.com/telehash/telehash.org/tree/master/v3) for both node and browserify.

The browser crypto that powers this is only possible thanks to the incredible work done by the team behind [Forge](https://github.com/digitalbazaar/forge), [Tom Wu](http://www-cs-students.stanford.edu/~tjw/), and the [Sanford Javascript Crypto Library](https://github.com/bitwiseshiftleft/sjcl).

# Router

Telehash apps usually need one or more mesh routers to assist in establishing p2p links, there are some test ones in [links.json](links.json).  You can run your own router via `npm start`, manually via `node bin/router.js`, or just `router` if you did an `npm install -g`.  The JSON object from the router output can be passed in to the `mesh.link({...})` function (shown below) or stored in your own `links.json`.

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

## Mesh Creation

Needs an endpoint id object from a previously run `generate()` to initialize from:

```js
var th = require("telehash");
var id = {"keys":{"1a":"akndnx5kbansip6xphxymwckpqkjj26fcm"},"secrets":{"1a":"ksxslm5mmtymnbph7nvxergb7oy3r35u"},"hashname":"5uegloufcyvnf34jausszmsabbfbcrg6fyxpcqzhddqxeefuapvq"};

var mesh = th.mesh({id:id});
```

A second argument can be passed and will be called after the mesh is fully initialized, and return any startup errors:

```js
th.mesh({id:id}, function(err, mesh){
  if(err) return console.log("mesh failed to initialize",err);
  // use mesh.* now
});
```

The args passed in to the `mesh` may include:

* **id** - An endpoint id object previously generated
* **links** - An object in the [mesh json](https://github.com/telehash/telehash.org/blob/master/v3/json.md) format that will be auto-loaded

In node, the `id` and `links` can be strings pointing to local filenames that will be auto-loaded.  In the browser they can be string keys to localStorage.  Those locations will also be generated and kept in sync for any changes.

## Establishing Links

A link can be created with just a hashname (this requires a router to assist):

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

A link can also be establish directly (no router required):

````js
var link = mesh.link({keys:{},paths:{}});
````

The `.link({args})` will also take an argument of `"jwt":"..."` to include a [JWT](http://jwt.io/) in the link request for identifying/authorizing the sender.

### Accepting/Authorizing Links

When an incoming link is requested the local app must decide if it accepts that link.  By default all unknown links/senders are ignored and never responded to in order to protect the privacy of the recipient.

To process incoming link requests:

````js
mesh.accept = function(from){};
````

The accept function will always be called with a from object that includes the hashname of the sender and any additional details about the request including `keys`, `paths`, and all handshake types received as `hset`.

To authorize/accept the request, simply perform a `mesh.link(from)` and it will respond and create the link.

## Routing

By default every endpoint will assist with routing between any of the active links in its mesh in order to maximize connectivity, but this requires the routing endpoint to be connected to both which may not always be the case.

One or more links can be dedicated routers for all other link requests, and/or any link can be used as a router for another:

````js
mesh.router(link); // any link can be used as a default router
mesh.link({...,router:true}); // another way to set a link as a default router from the start

link.router(link); // just one link can be used as a router for another
mesh.link({...,paths:[{type:'peer',hn:'linked'}]}); // including a peer path to an already-linked hashname will automatically use it as a router
````

Whenever a default router is added, it will also be advertised to other links as a peer path for this endpoint.

## Discovery Mode

Discovery mode enables any network transport to send un-encrypted announcements to any other endpoints that are available locally only. This can be used to automatically establish a link to a local peer when there is no other mechanism to exchange keys, such as when they are offline.

It is important to note that this should be used sparingly, as anything on a local network will be made aware of the sending hashname.  While this is generally very low risk, it should not be left on by default except in special cases.

````js
mesh.discover(true); // to enable
mesh.discover(false); // to disable (default)
````

While discover is enabled, `mesh.accept` will be called for all discovered local endpoints.

Optional args and a callback (to know once discovery is enabled on all the transports) can be passed in:

````js
mesh.discover({args},done);
````

The args can include:

* `jwt` - a JWT to include in the announcement to help identify the sender
* custom per-transport discovery options may be passed in

## Extensions

Most functionality is added by extending the core library to support additional channels and expose more methods. The built-in extensions live in the [ext](ext/) folder, but additional ones can be added by the app.

* **path** - check and synchronize all network paths on a link:
````js
link.ping(function(err, latency){
  // error if it failed
  // latency is number of milliseconds if it succeeded (may be 0)
});
````

* **stream** - native duplex `Stream` creation, also supports streaming objects
````js
link.stream(); // returns a new duplex stream to this link, optional args are sent to the link during creation
fs.createReadStream(filein).pipe(link.stream()); // can be used as a pipe
// to receive incoming streams
mesh.stream(function(link, args, cbAccept){
  // link is who it came from
  // args is set if any were given by the sender
  // call cbAccept(err); to cancel
  // cbAccept() returns a duplex stream
  cbAccept().pipe(fs.createWriteStream(fileout));
});
````

### Extension Backing API

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

A mesh will use all available transports to establish and maintain a link.

### Transport Backing API

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


