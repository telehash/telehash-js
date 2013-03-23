var tele = require("../telehash");
var opkeys = require("./ollie.json");
var operator = tele.hashname("testing.private", opkeys, {port:42424});
console.log("ollie address is ", operator.address);

Object.keys(opkeys).map(function(key){
  var hn = tele.hash(opkeys[key]+"testing.private").toString();
  opkeys[hn] = opkeys[key];
});
operator.myLookup(function(hn, callback){
  console.log("lookup",hn)
	if (opkeys[hn]) return callback(null, opkeys[hn]);
	callback("not found");
});
