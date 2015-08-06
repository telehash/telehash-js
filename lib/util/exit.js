// signal connected channels to end
var meshes = []

function exitHandler(options, err) {
  console.log("CLEANUP")
  if (options.cleanup)
  meshes.forEach(function(mesh){
    Object.keys(mesh.index).forEach(function (link){
      link = mesh.index[link]

      Object.keys(link.x.channels).forEach(function(chan){

        console.log("failing channel", chan)
        chan = link.x.channels[chan]
        if (!(chan.state == "gone"))
          chan.send({json:{end:true}});
      })
    })
  })
    if (err) console.log(err.stack);
    if (options.exit) setTimeout(process.exit.bind(process),2000);
}

//do something when app is closing
process.on('exit', exitHandler.bind(null,{cleanup:false}));

//catches ctrl+c event
process.on('SIGINT', exitHandler.bind(null, {cleanup: true,exit:true}));

//catches uncaught exceptions
process.on('uncaughtException', exitHandler.bind(null, {exit:true}));

module.exports = function(mesh){
  meshes.push(mesh)
}
