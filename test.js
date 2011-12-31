var slib = require("./switch");

var s = new slib.Switch("1.2.3.4:5678");
console.log(s);

var th = require("./telehash");
th.init({port:42424});