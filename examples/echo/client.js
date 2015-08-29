var th = require('../../index.js'),
    fs = require('fs');


th.load({id:"client."+ Date.now() +".json"}, function (e,mesh) {
  if (e) throw e;
  console.log("client uri: ", mesh.uri());

  mesh.discover(true);

  mesh.accept = function (from) {
    console.log("INCOMING:", from.hashname);
    var link = mesh.link(from);


    link.on('status',function(up){
      console.log("link status")

      // only the echo server has a mesh.stream handler, so all client discoveries will drop
      var chan = link.stream();
      chan.write("Hello?");
      var i = 0;
      setInterval(function () {
        chan.write(mesh.hashname.substr(0,8) + ": Test #"+(++i));
      }, 5e3);
      chan.on('data', function (d) {
        console.log("DATA:",d.toString());
      });
    })
  };
});
