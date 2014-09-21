var hashname = require('hashname');
var Pipe = require('../pipe').Pipe;

// handle type:peer paths to create peer channels
exports.name = 'peer';

exports.mesh = function(mesh, cbExt)
{
  var log = mesh.log;
  var peer = {};
  peer.pipes = [];
  peer.pipe = function(link, path, cbPipe){
    var pipes = this.pipes;
    if(path.type != 'peer') return;
    if(!hashname.isHashname(path.hn)) return log.warn(link.hashname,'given invalid peer path',path);

    // TODO clean up link.json.paths remove any if to a default router

    // create unique peering id to track created pipes
    var id = [link.hashname,path.hn].join(':');
    if(pipes[id]) return pipes[id];

    // make a new pipe for this peering
    var pipe = pipes[id] = new Pipe('peer');
    pipe.id = id;
    pipe.path = path;

    // TODO create connect channel and pipe for it
    log.debug('TODO make connect to router for',id);
    cbPipe(pipe);
  }
  
  cbExt(undefined, peer);
}
