var tele = require("../telehash");
var opkeys = require("./operator.json");
var ollie = tele.hashname("testing.private", require("./ollie.json"));
ollie.addOperator(process.argv[2], process.argv[3], opkeys.public);
console.log("ollie address is ", ollie.address);
ollie.online(function(err){
  console.log("ollie online status", err?err:true);
  if(!err);
  ollie.stream("842088702734e897a996f66b3f879adb38002258", function(ollie, packet, callback){
    console.log(packet.js);
    callback();
  }).send({type:"42"});
});
