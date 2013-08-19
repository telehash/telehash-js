var tele = require("..");
var seed = require("./seed.json");
var app = tele.hashname(require("./app.json"));
app.addSeed({ip:"localhost", port:42424, pubkey:seed.public});
app.online(function(err){
  console.log("app online status", err?err:true);
});
