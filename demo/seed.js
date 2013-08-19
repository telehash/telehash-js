var tele = require("..");
var key = require("./seed.json"); // loads the keypair

// start a new hashname in the given space with these keys, listen on this specific port
var seed = tele.hashname(key, {port:42424});
console.log("seed online at", seed.ip+":"+seed.port, "with the hashname", seed.hashname);

// custom stream example
seed.listen("42", function(operator, packet){
  console.log("got a 42 from", packet.from.address);
  packet.stream.send({"universe":true, end:true});
});
