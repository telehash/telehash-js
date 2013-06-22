var tele = require("../telehash");
var opkeys = require("./operator.json"); // loads the keypair

// start a new hashname in the given space with these keys, listen on this specific port
var operator = tele.hashname("testing.private", opkeys, {port:42424});
console.log("operator address is ", operator.address);

// custom stream
operator.listen("42", function(operator, packet, callback){
  console.log("got a 42 from", packet.from.address);
  packet.stream.send({"universe":true, end:true});
  callback();
});
