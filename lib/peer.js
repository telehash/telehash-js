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

  peer.open = {};
  // exchange handlers for new opens
  peer.open.peer = function(args, open, cbOpen){
    if(typeof open.json.peer != 'string' || !mesh.links[open.json.peer]) return log.debug('dropping peer to unknown',open.json.peer);
    log.debug('TODO peer/connect relay');
    // if encrypted, just forward directly
    // if not, send via connect
  }
  peer.open.connect = function(args, open, cbOpen){
    var attached = lob.decode(open.body);
    if(!attached) return log.debug('dropping connect, invalid attached');

    if(attached.head.length <= 1) log.debug('dropping connect, encrypted attached');

    // who is this from?
    var from = {};
    from.hashname = hashname.fromPacket(attached);
    if(!from.hashname) return log.debug('dropping connect, no hashname',attached.json);
    from.csid = hashname.match(mesh.keys,attached.json);
    if(!from.csid) return log.debug('dropping connect, unsupported csid',attached.json);
    from.paths = [{type:'peer',hn:link.hashname}];
    from.key = attached.body;

    // see if we trust this hashname
    if(!mesh.links[from.hashname])
    {
      log.debug('untrusted hashname',from);
      if(mesh.onDiscover) mesh.onDiscover(from);
      return;
    }

    log.debug('TODO add new peer path, sync');
  }

  cbExt(undefined, peer);
}
