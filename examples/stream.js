var es = require('event-stream');
var telehash = require('..');

var meshA = telehash.mesh({id:{"keys":{"1a":"akndnx5kbansip6xphxymwckpqkjj26fcm"},"secrets":{"1a":"ksxslm5mmtymnbph7nvxergb7oy3r35u"},"hashname":"5uegloufcyvnf34jausszmsabbfbcrg6fyxpcqzhddqxeefuapvq"}});

var meshB = telehash.mesh({id:{"keys":{"1a":"apkoh54rkobkeela6d62hblhqd7grqd5dm"},"secrets":{"1a":"ljfm3ov42x2fl6gsg6bxiqgtstnxls7r"},"hashname":"fvifxlr3bsaan2jajo5qqn4au5ldy2ypiweazmuwjtgtg43tirkq"}});

// connect them to each other (for same-process testing only)
meshA.mesh(meshB);

// accept a stream of items
meshB.stream(function(link, req, accept){
  var streamBA = accept();
  streamBA.pipe(es.writeArray(function(err,items){
    console.log(items);
    process.exit(0);
  }));
})

// stream objects from A to B
var streamAB = meshA.link(meshB.hashname).stream();
es.readArray([1,2,true,{all:42}]).pipe(streamAB);
