# Overview

This module presents a simple high-level API for using TeleHash, currently it has only two basic functions, *listen* and *connect*.

## Listen

    var telehash = require("telehash");
    telehash.seed(function(err){
      telehash.listen({id:"asdf"}, function(telex){
        console.log(telex);
      })
    })

This will seed you into the DHT and actively wait for any connect requests sent to the provided id. The telex will be the JSON object sent in the original request. Upon receiving, a reply can be sent with:

    telehash.send(telex.from, {...});

This will attempt to work through any NATs and firewalls as well, going directly peer-to-peer.

## Connect

    var telehash = require("telehash");
    telehash.connect({id:"asdf", ...}, function(reply){
      console.log(reply);
    })

This will use the DHT to find anyone listening to that id and send along anything else included in the JSON object.  Replies (if any, and may be multiple too) will fire the callback function.
