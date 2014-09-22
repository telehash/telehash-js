exports.name = 'path';

exports.mesh = function(mesh, cbExt)
{
  var ext = {open:{}};

  // path sync requests
  ext.open.listen['path'] = function(args, open, cbOpen){
    var did = [];
    function pong(pipe)
    {
      if(did.indexOf(pipe) >= 0) return;
      did.push(pipe);
      var json = {c:open.json.c};
      if(pipe.path) json.path = pipe.path;
      link.x.send({json:json},pipe);
    }
    // go through all the pipes we have already and send a response
    link.pipes.forEach(pong);
    // add any of the included paths, and send to them too
    if(Array.isArray(open.paths)) open.paths.forEach(function(path){
      link.addPath(path,pong);
    });
  }
  

  cbExt(undefined, ext);
}
