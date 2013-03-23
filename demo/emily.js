var fs = require("fs");
var tele = require("../telehash");

// what is our operator, pass in or replace this value
var opaddress = process.argv[2];

// load up our private key
var ckeys = require("./emily.json");

// start up our client hashname in the same space
var client = tele.hashname("testing.private", ckeys);

// provide the operator(s) for this hashname
client.setOperators([opaddress]);

// line to operator first
client.doLine(opaddress.split(",")[0], function(err){
	if(err) return console.log("failed to open operator:", err);
  console.log("operator opened");
  // line to anya, should lookup via operator
	client.doLine("7aac3b2a72bce56d88b0f88b946d2b5167142d2c", function(err, hn){
  	if(err) return console.log("line failed to anya:", err);
	  console.log("\n\nanya connected", hn, "\n\n");
//	  client.doSocket({hashname:"7aac3b2a72bce56d88b0f88b946d2b5167142d2c", listen:2001, to:"127.0.0.1:2010"}, function(err){
//	    console.log("SOCKET",err);
//	  })
	  client.doProxy({hashname:"7aac3b2a72bce56d88b0f88b946d2b5167142d2c", path:"/"}, function(err, res, body){
	    console.log("PROXY",err, res, body.toString());
	  })
//	  var stream = client.doProxyStream({hashname:"7aac3b2a72bce56d88b0f88b946d2b5167142d2c", path:"/", method:"POST"}, function(res){
//	    console.log("PROXYSTREAM",res);
//	  });
//	  require("request").get("http://google.com").pipe(stream);
//	  stream.on("data", function(data){console.log("PROXYDATA", data)})
//	  stream.on("end", function(data){console.log("PROXYEND")});
//	  stream.end()
;	});
})
