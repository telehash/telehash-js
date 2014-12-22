var hashname = require('hashname');
var lob = require('lob-enc');
var crypto = require('crypto');

// handle type:peer paths to create peer channels, https://github.com/telehash/telehash.org/blob/v3/v3/channels/peer.md
exports.name = 'peer';

exports.mesh = function(mesh, cbExt)
{
  var log = mesh.log;
  var Pipe = mesh.lib.Pipe;
  var pipes = [];
  var peer = {};
  peer.open = {};
  
  // actually create/return the pipe
  function piper(to, cbPiper)
  {
    if(pipes[to]) return cbPiper(pipes[to]);

    // make a new pipe for this peering
    var pipe = pipes[to] = new Pipe('peer');
    pipe.to = to;
    pipe.path = {type:'peer',hn:to};

    // handle any peer delivery through the router
    pipe.onSend = function(packet, link, cbSend)
    {
      var router = mesh.index[to];
      if(!router) return cbSend('cannot peer to an unknown router: '+pipe.to);
      if(!router.x) return cbSend('cannot peer yet via this router: '+pipe.to);
      if(!link) return cbSend('requires link');
      
      // no packet means try to send our keys
      if(!packet)
      {
        Object.keys(mesh.keys).forEach(function(csid){
          if(link.csid && link.csid != csid) return; // if we know the csid, only send that key
          var json = {type:'peer',peer:link.hashname,c:router.x.cid()};
          var body = lob.encode(hashname.toPacket(mesh.keys,csid));
          log.debug('sending peer key to',router.hashname,json,csid);
          router.x.send({json:json,body:body});
        });
        return;
      }
      
      // if it's an encrypted channel packet, pass through direct to router
      if(packet.head.length == 0) return router.x.sending(packet);

      // otherwise we're always creating a new peer channel to carry the request
      var json = {type:'peer',peer:link.hashname,c:router.x.cid()};
      var body = lob.encode(packet);
      log.debug('sending peer handshake to',router.hashname,json,body);
      router.x.send({json:json,body:body});
      cbSend();
    }

    cbPiper(pipe);
  }

  peer.pipe = function(link, path, cbPipe){
    if(path.type != 'peer') return;
    if(!hashname.isHashname(path.hn)) return log.warn(link.hashname,'given invalid peer path',path);

    // TODO clean up link.json.paths remove any if to a default router

    piper(path.hn, cbPipe);
  }

  // exchange handlers for new opens
  peer.open.peer = function(args, open, cbOpen){

    // be extra paranoid when routing
    var from = this;
    if(typeof open.json.peer != 'string') return log.debug('invalid peer request',open.json.peer);
    if(open.json.peer == mesh.hashname) return log.debug('invalid peer to self');
    var to = mesh.index[open.json.peer];
    if(!to) return log.debug('dropping peer, no link to',open.json.peer);
    if(!to.x) return log.debug('dropping peer to unknown link',open.json.peer);
    if(to.down && from.down) return log.debug('can only route when either to or from is up',to.down,from.down);

    // if a handshake, grab the token for routing
    var attached = lob.decode(open.body);
    if(attached && attached.head.length == 1)
    {
      var token = crypto.createHash('sha256').update(attached.body.slice(0,16)).digest().slice(0,16).toString('hex');
      log.debug('setting route for',token,args.pipe.path);
      mesh.routes[token] = args.pipe;
    }

    // just forward the body directly as a connect
    var json = {type:'connect',c:to.x.cid()};
    log.debug('sending connect to',to.hashname,json,open.body);
    to.x.send({json:json,body:open.body});
  }
  
  // handle incoming connect requests
  peer.open.connect = function(args, open, cbOpen){
    var via = this;
    var attached = lob.decode(open.body);
    if(!attached) return log.debug('dropping connect, invalid attached');

    if(attached.head.length == 0) log.debug('dropping connect, encrypted attached');

    // get the peer pipe
    piper(via.hashname, function(pipe){
      log.debug('handling connect',attached.head.length==1?'handshake':'keys',pipe.path);
      if(attached.head.length == 1)
      {
        // handle a handshake by delivering via a peer pipe AND the router's pipe
        mesh.receive(attached, pipe);
        mesh.receive(attached, args.pipe);
      }else{
        // otherwise try processing it as an un-encrypted handshake
        mesh.handshake(via.hashname, attached, pipe);
      }
      cbOpen();
    });
  }

  cbExt(undefined, peer);
}
