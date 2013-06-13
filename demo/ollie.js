var tele = require("../telehash");
var opkeys = require("./operator.json");
var ollie = require("./ollie.json");
var client = tele.hashname("testing.private", ollie);
console.log("ollie address is ", client.address);

var op = client.doSeen("842088702734e897a996f66b3f879adb38002258");
op.ip = client.ip;
op.port = 42424;
op.pubkey = opkeys.public;
client.doSend(op, {js:{foo:"bar"}});
