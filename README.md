# Overview

[![telehash](https://nodei.co/npm/telehash.png)](https://nodei.co/npm/telehash/)
	
This module presents a simple high-level API for using [telehash](https://github.com/telehash/telehash.org/blob/master/protocol.md) for both node and browserify.

The browser crypto that powers this is only possible thanks to the incredible work done by the team behind [Forge](https://github.com/digitalbazaar/forge), [Tom Wu](http://www-cs-students.stanford.edu/~tjw/), and the [Sanford Javascript Crypto Library](https://github.com/bitwiseshiftleft/sjcl).

# Seeds

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
