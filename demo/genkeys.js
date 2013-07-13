var tele = require("..");
var fs = require("fs");
tele.genkey(function(err, key){
  fs.writeFileSync("./seed.json", JSON.stringify(key, null, 4));  
});
tele.genkey(function(err, key){
  fs.writeFileSync("./app.json", JSON.stringify(key, null, 4));  
});
