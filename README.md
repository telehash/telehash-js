# Overview

[![telehash](https://nodei.co/npm/telehash.png)](https://nodei.co/npm/telehash/)

This module presents a simple high-level API for using [telehash](https://github.com/telehash/telehash.org/blob/master/protocol.md) for both node and browserify.

The browser crypto that powers this is only possible thanks to the incredible work done by the team behind [Forge](https://github.com/digitalbazaar/forge), [Tom Wu](http://www-cs-students.stanford.edu/~tjw/), and the [Sanford Javascript Crypto Library](https://github.com/bitwiseshiftleft/sjcl).

# Router

Telehash apps always need one or more seeds to bootstrap from, the default development testing ones are in [seeds.json](https://github.com/quartzjer/telehash-seeds/blob/master/seeds.json).  You can run your own seed via `npm start` or manually via `node seed.js`.  The JSON object from the seed can be passed in to the init function (shown below) as "seeds":{...} in the args or stored in a seeds.json file with that passed in.

# Library Interface

## Identity / Keypair Generation

To create a new hashname:

```js
var th = require("telehash");
th.init({}, function(err, self){
  if(err) return console.log("hashname generation/startup failed",err);
  // self.id contains a the public/private keys and parts
});
```

## Hashname Initialization / Startup

Needs an id object from a previously created self.id to load the existing hashname from:

```js
var th = require("telehash");
th.init({id:id}, function(err, self){
  if(err) return console.log("hashname failed to come online",err);
  // use self.* now
});
```

## Args

The first object passed in to the `load` function takes the following arguments:

* **id** - An object previously created, or a string pointing to a file to load the object from.
* **seeds** - An object in the [seeds](https://github.com/telehash/telehash.org/blob/master/seeds.md) format, or a string pointing to a file to load from.

## API

Once you have a hashname running you can use the [common API](https://github.com/telehash/thjs#API) with it.

Below is a trivial example, taking off from a properly initialized switch. For an "In the wild" example, see [ndn-telehashTransport](https://github.com/rynomad/ndn-telehashTransport), which allows one to use telehash for named data networking.

```js
channelName = "AWESOME"

funcion packetHandler(err, packet, chan, callback){
  //check for error
  if (err) return console.log("oh noes, we got an error! ", err);

  //packet.js and packet.body are your json message and binary data(if present)
  console.log(packet.js, packet.body) // {myName: "Steve"}, null <-- see firstPacket below

  //call the callback with true to send an ack and recieve subsequent packets
  callback(true)

  //send a response
  var response = {
    js: {
      isAwesome: true,
      ownsCat: false,
      interests: [
        "telehash",
        "dogs",
        "bad horror movies"
      ]
    }
    body: myPreconstrucedBuffer //some Uint8Array.buffer or node.js Buffer.buffer
  }
  chan.send(response)

}
//begin listening for incoming packets on a channel named 'AWESOME'
self.listen(channelName, packetHandler)

//start a channel to another hashname, assuming they have the listener above
//(hashname given generated by use of keyboard smashing, you should use a real hashname)

firstPacket = {
  js: {
    myName: "Steve"
  }
}

targetHashname = "fj04f4mc5405085mq043q04c48u5mc045mc09mwq098m4c03m084c50493"

self.start(targetHashname, channelName, firstPacket, packetHandler)


## Transports

All transports are implemented as their own modules that expose the functionality of:

* turnin a path into a pipe, pipe has a path (if any)
* incoming packets with a pipe
* outgoing packets to a pipe
* pipe event of keepalive, closed, and changed
* return available source paths
* enable discovery mode

Using an interface like:

````
var tp = require('telehash-x');
tp.path(path, function(pipe){
  pipe.path; // current json object (if addressable)
  pipe.on('keepalive', function(){}) // adds callback, return false to unregister
  pipe.on('changed', function(){})
  pipe.on('closed', function(){})
  pipe.send(packet)
});
var paths = tp.paths(); // return array of current addressible paths, if any
tp.discovery(packet, cb); // enables/disables discovery mode, will create new pipes for incoming, cb when done
tp.deliver(function(packet, pipe) { ... }, cb); // where to send packets, cb when done
````


## Extensions

Most functionality is added by extending the core library to support additional channels and expose more methods. The built-in extensions live in the [lib](lib/) folder, but additional ones can be added by the app.

Extensions typically involve:

* handling one or more channel types
* adding one or more methods to a created mesh instance
* adding one or more methods to every link instance within a mesh

Using an interface like:

````
var ext = require('ext');
mesh.extend(ext);
// calls:
ext.mesh(mesh, cb);
ext.link(link, cb);
````


