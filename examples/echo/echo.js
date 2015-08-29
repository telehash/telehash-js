var th = require('../../index.js'),
    fs = require('fs');

th.load({id:"echo.json"}, function (e,mesh) {
  if (e) throw e;
  console.log("echo uri: ",mesh.uri());

  mesh.discover(true);

  var chan;
  mesh.accept = function (from) {
    console.log("INCOMING:", from.hashname);
    mesh.link(from)
  };

  mesh.stream(function (from, args, accept){
    console.log("GOT INCOMING STREAM")
    var chan = accept();
    chan.on('data', function (d) {
      d = d.toString();
      console.log("ECHO:", d);
      chan.write(d.toUpperCase());
    });
  });
});
