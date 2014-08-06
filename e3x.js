// rough mapping of e3x api to javascript

// create new endpoint keys
e3x.generate(function(err, keys, secrets){});

// load keys and secrets to start a new local "self"
e3x.self(keys, secrets, function(err, self){
  // process any incoming buffer into a packet
  var packet = self.receive(buffer);
  // if valid, packet.key/parts (decide trust) or packet.token (find existing exchange) is set
});

// new exchange with this key, verifies matching best cipher set id w/ self keys
// trust the given exchange key before creation
e3x.create(self, csids, key, function(err, exchange){
  exchange.token; // 16 byte buffer id
  var packet = exchange.decrypt(buffer);
  var buffer = exchange.encrypt(packet);
  var buffer = exchange.keepalive();
  var bool = exchange.receive(packet); // returned from self.receive, validates/decrypts then processes it
  exchange.sending = function(buffer, exchange){
    // send to network
  };
  exchange.receiving = function(packet, chan){
    // process packets for existing or new incoming channels
    // all channels will receive an err once they're fully closed (may be ended already)
    // if there's no channels open, all token/exchange references can be removed
  };
  var chan = exchange.channel({kind:"unreliable", timeout:10000});
  chan.exchange, chan.id, chan; // reference
  var packet = chan.packet();
  exchange.send(packet);
  
});
