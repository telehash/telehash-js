var port = process.env.PORT || 8008;

var httpServer = require("http").createServer(function(req, resp) {
  req.url.replace("..",""); // this is super dumb minimal stub, don't actually use as a server
  var path = req.url;
  if(req.url == "/") path = "/load.html";
  path = __dirname+path;
  console.log(path);
  require("fs").readFile(path, "utf8", function(error, content) {
    resp.writeHeader(200, {"Content-Type": "text/html"});
    resp.end(content);
  });
}).listen(port, function(){console.log("listening on",port)});