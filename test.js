
var th = require("./telehash");

var from = {streams:{}};
var seq = 0;
var hook = th.test(function(self, to, packet){
  console.log("SEND",packet);
  if(packet.js.miss && packet.js.miss[0] == 1)
  {
    var js = {stream:stream.id, seq:1, "foo":"bar1.5"};
    hook.inStream(self, {from:from, js:js});
  }
  if(packet.body)
  {
    var js = {stream:stream.id, seq:seq++};
    hook.inStream(self, {from:from, js:js, body:packet.body.toString()+"42"});
    
  }
});
//var js = {who:"42", "from":"67"};
//hook.incoming({hashname:"42", pubkey:"SECRET"}, {js:js, from:{ip:"x.x.x.x", port:42}});
var self = {seen:{"42":{line:true}}};
var stream = hook.doStream(self, "42", function(err, packet, callback){
  console.log("STREAM PACKET", packet.stream.id, packet.js);
//  console.log(packet.stream);
  callback();
});
console.log(stream);
from.streams[stream.id] = stream;

// test missing packets
//var js = {stream:stream.id, seq:2, "foo":"bar2"};
//hook.inStream(self, {from:from, js:js});
//var js = {stream:stream.id, seq:0, "foo":"bar1"};
//hook.inStream(self, {from:from, js:js});

// test sock
//var js = {stream:stream.id, seq:seq++, "sock":"127.0.0.1:4442"};
//hook.inStream(self, {from:from, js:js, body:"hello"});

// test proxy
var js = {stream:stream.id, seq:seq++, req:{m:"GET"}, end:true};
self.proxy = {host:"jeremie.com", port:80};
hook.inProxy(self, {stream:stream, from:from, js:js}, function(){});

/*
var keypair = require(process.argv[2]);
var test = th.hashname("test", keypair);
console.log(test.address);
test.setOperators(["1e9f22cdb675bd9d67ec10c2f21c020acc0bd20f,172.16.42.34,58625"]);
test.doWho("1e9f22cdb675bd9d67ec10c2f21c020acc0bd20f", function(err, key){
  console.log("WHOM", err, key);
});

var hash = require("./hash");
var a = new hash.Hash(null, "a9993e364706816aba3e25717850c26c9cd0d89d");
var b = new hash.Hash(null, a.far());
console.log(a.equals(b));
console.log(a.cmp(b));
console.log(a.distanceTo(b));
var b = new hash.Hash(null, "a8993e364706816aba3e25717850c26c9cd0d89d");
console.log(a.equals(b));
console.log(a.cmp(b));
console.log(a.distanceTo(b));

var x1 = new hash.Hash(null, "a8993e364706816aba3e25717850c26c9cd0d89d");
var x2 = new hash.Hash(null, "a9893e364706816aba3e25717850c26c9cd0d89d");
var x3 = new hash.Hash(null, "a9983e364706816aba3e25717850c26c9cd0d89d");

var x = [x3, x1, x2];
x.forEach(function(h){console.log(h.toString())});
var y = x.sort(function(s1, s2){ return a.distanceTo(s1) - a.distanceTo(s2) });
y.forEach(function(h){console.log(h.toString())});
*/