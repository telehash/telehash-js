
var th = require("./telehash");
var keypair = require(process.argv[2]);

var test = th.hashname("test", keypair);
console.log(test.address);
test.setOperators(["1e9f22cdb675bd9d67ec10c2f21c020acc0bd20f,172.16.42.34,58625"]);
test.doWho("1e9f22cdb675bd9d67ec10c2f21c020acc0bd20f", function(err, key){
  console.log("WHOM", err, key);
});

/*
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