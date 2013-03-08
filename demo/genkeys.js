var fs = require('fs');
var tele = require("../telehash");
var opkeys = tele.createKeys();
fs.writeFileSync("./operator.json", JSON.stringify(opkeys, null, 4));
var ckeys = tele.createKeys();
fs.writeFileSync("./client.json", JSON.stringify(ckeys, null, 4));